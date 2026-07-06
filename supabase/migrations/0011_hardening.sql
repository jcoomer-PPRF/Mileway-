-- ============================================================================
-- Mileway — 0011: security hardening
--
-- Closes the four findings from the 2026-07-06 verification run
-- (supabase/tests/ is the executable proof; it fails on 0001–0010 and must
-- pass on 0001–0011):
--
--   1. STORAGE — personal credential FILES were readable/listable by every
--      authenticated user; only the document ROWS were gated. Personal files
--      now live under personal/<profile_id>/… and the documents-bucket
--      policies gate on that prefix (subject or oversight roles).
--   2. FORGERY — created_by (and created_at) could be supplied by the client
--      on INSERT; tg_set_audit_fields kept the supplied value.
--   3. DEMOTION — a user demoted to auditor/accountant kept edit/delete on
--      records they created earlier; the own-record policy arm had no
--      write-tier check.
--   4. DEACTIVATION — profiles.is_active was enforced by nothing. It now
--      gates every read and write policy (via the helper functions and the
--      select policies), is trigger-protected like role, and the app pairs it
--      with an Auth-level ban through the set-user-active Edge Function.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Finding 2: created_* cannot be forged by authenticated users.
-- The coalesce is flipped: when a real user is acting (auth.uid() not null)
-- the server's values win unconditionally. Seed scripts and service-role jobs
-- (auth.uid() is null) may still provide explicit values — 0004's seeds and
-- the Phase 3 scheduled job depend on that.
-- ---------------------------------------------------------------------------
create or replace function public.tg_set_audit_fields()
returns trigger
language plpgsql
as $$
begin
  if (tg_op = 'INSERT') then
    if auth.uid() is not null then
      new.created_at := now();
      new.created_by := auth.uid();
    else
      new.created_at := coalesce(new.created_at, now());
    end if;
    new.updated_at := now();
    new.updated_by := coalesce(auth.uid(), new.updated_by);
  elsif (tg_op = 'UPDATE') then
    -- created_* can never change after the row is born.
    new.created_at := old.created_at;
    new.created_by := old.created_by;
    new.updated_at := now();
    new.updated_by := coalesce(auth.uid(), new.updated_by);
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Finding 4: the actor's is_active gates everything.
-- New helper + every permission helper now requires an ACTIVE profile, so all
-- write policies inherit the gate; the select policies below add it for reads.
-- ---------------------------------------------------------------------------
create or replace function public.is_active_user() returns boolean
  language sql stable security definer set search_path = public, pg_temp
  as $$ select coalesce((select is_active from public.profiles where id = auth.uid()), false); $$;

create or replace function public.is_admin() returns boolean
  language sql stable security definer set search_path = public, pg_temp
  as $$ select coalesce((select role = 'owner' and is_active from public.profiles where id = auth.uid()), false); $$;

create or replace function public.is_owner() returns boolean
  language sql stable security definer set search_path = public, pg_temp
  as $$ select coalesce((select role = 'owner' and is_active from public.profiles where id = auth.uid()), false); $$;

create or replace function public.can_edit_all() returns boolean
  language sql stable security definer set search_path = public, pg_temp
  as $$ select coalesce((select role in ('owner','manager') and is_active from public.profiles where id = auth.uid()), false); $$;

create or replace function public.can_write() returns boolean
  language sql stable security definer set search_path = public, pg_temp
  as $$ select coalesce((select role in ('owner','manager','contributor') and is_active from public.profiles where id = auth.uid()), false); $$;

create or replace function public.can_read_financials() returns boolean
  language sql stable security definer set search_path = public, pg_temp
  as $$ select coalesce((select role in ('owner','manager','accountant','auditor') and is_active from public.profiles where id = auth.uid()), false); $$;

-- ---------------------------------------------------------------------------
-- Finding 4: read policies require an active actor.
-- Exception: a deactivated user may still read their OWN profile row — the
-- app needs it to show the deactivated-account message instead of an error.
-- ---------------------------------------------------------------------------
drop policy if exists profiles_select on public.profiles;
create policy profiles_select on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_active_user());

drop policy if exists entities_select on public.entities;
create policy entities_select on public.entities
  for select to authenticated using (public.is_active_user());

drop policy if exists trip_categories_select on public.trip_categories;
create policy trip_categories_select on public.trip_categories
  for select to authenticated using (public.is_active_user());

drop policy if exists expense_categories_select on public.expense_categories;
create policy expense_categories_select on public.expense_categories
  for select to authenticated using (public.is_active_user());

drop policy if exists mileage_rates_select on public.mileage_rates;
create policy mileage_rates_select on public.mileage_rates
  for select to authenticated using (public.is_active_user());

drop policy if exists vehicles_select on public.vehicles;
create policy vehicles_select on public.vehicles
  for select to authenticated using (public.is_active_user());

drop policy if exists trips_select on public.trips;
create policy trips_select on public.trips
  for select to authenticated using (public.is_active_user());

drop policy if exists expenses_select on public.expenses;
create policy expenses_select on public.expenses
  for select to authenticated using (public.is_active_user());

drop policy if exists job_titles_select on public.job_titles;
create policy job_titles_select on public.job_titles
  for select to authenticated using (public.is_active_user());

drop policy if exists location_types_select on public.location_types;
create policy location_types_select on public.location_types
  for select to authenticated using (public.is_active_user());

drop policy if exists saved_locations_select on public.saved_locations;
create policy saved_locations_select on public.saved_locations
  for select to authenticated using (public.is_active_user());

drop policy if exists maintenance_types_select on public.maintenance_types;
create policy maintenance_types_select on public.maintenance_types
  for select to authenticated using (public.is_active_user());

drop policy if exists maintenance_records_select on public.maintenance_records;
create policy maintenance_records_select on public.maintenance_records
  for select to authenticated using (public.is_active_user());

drop policy if exists maintenance_schedules_select on public.maintenance_schedules;
create policy maintenance_schedules_select on public.maintenance_schedules
  for select to authenticated using (public.is_active_user());

drop policy if exists document_types_select on public.document_types;
create policy document_types_select on public.document_types
  for select to authenticated using (public.is_active_user());

drop policy if exists documents_select on public.documents;
create policy documents_select on public.documents
  for select to authenticated
  using (public.is_active_user()
         and (profile_id is null or profile_id = auth.uid() or public.can_read_financials()));

drop policy if exists audit_log_select on public.audit_log;
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (public.is_active_user()
         and (public.is_owner() or public.current_user_role() in ('auditor', 'accountant')));

-- profiles_update: self-service edits also require an active actor.
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles
  for update to authenticated
  using ((id = auth.uid() and public.is_active_user()) or public.is_admin())
  with check ((id = auth.uid() and public.is_active_user()) or public.is_admin());

-- ---------------------------------------------------------------------------
-- Finding 3: the own-record edit/delete arm requires a write-tier role, so a
-- user demoted to auditor/accountant loses edit/delete on records they
-- created. (can_write() also carries the is_active gate from above.)
-- ---------------------------------------------------------------------------
drop policy if exists vehicles_update on public.vehicles;
drop policy if exists vehicles_delete on public.vehicles;
create policy vehicles_update on public.vehicles for update to authenticated
  using (public.can_edit_all() or (public.can_write() and created_by = auth.uid()))
  with check (public.can_edit_all() or (public.can_write() and created_by = auth.uid()));
create policy vehicles_delete on public.vehicles for delete to authenticated
  using (public.can_edit_all() or (public.can_write() and created_by = auth.uid()));

drop policy if exists trips_update on public.trips;
drop policy if exists trips_delete on public.trips;
create policy trips_update on public.trips for update to authenticated
  using (public.can_edit_all() or (public.can_write() and created_by = auth.uid()))
  with check (public.can_edit_all() or (public.can_write() and created_by = auth.uid()));
create policy trips_delete on public.trips for delete to authenticated
  using (public.can_edit_all() or (public.can_write() and created_by = auth.uid()));

drop policy if exists expenses_update on public.expenses;
drop policy if exists expenses_delete on public.expenses;
create policy expenses_update on public.expenses for update to authenticated
  using (public.can_edit_all() or (public.can_write() and created_by = auth.uid()))
  with check (public.can_edit_all() or (public.can_write() and created_by = auth.uid()));
create policy expenses_delete on public.expenses for delete to authenticated
  using (public.can_edit_all() or (public.can_write() and created_by = auth.uid()));

drop policy if exists maintenance_records_update on public.maintenance_records;
drop policy if exists maintenance_records_delete on public.maintenance_records;
create policy maintenance_records_update on public.maintenance_records for update to authenticated
  using (public.can_edit_all() or (public.can_write() and created_by = auth.uid()))
  with check (public.can_edit_all() or (public.can_write() and created_by = auth.uid()));
create policy maintenance_records_delete on public.maintenance_records for delete to authenticated
  using (public.can_edit_all() or (public.can_write() and created_by = auth.uid()));

drop policy if exists documents_update on public.documents;
drop policy if exists documents_delete on public.documents;
create policy documents_update on public.documents for update to authenticated
  using (public.can_edit_all() or (public.can_write() and created_by = auth.uid()))
  with check (public.can_edit_all() or (public.can_write() and created_by = auth.uid()));
create policy documents_delete on public.documents for delete to authenticated
  using (public.can_edit_all() or (public.can_write() and created_by = auth.uid()));

-- ---------------------------------------------------------------------------
-- Finding 4: is_active is protected like role — only an active owner may
-- change either — and the org can never be locked out: the last active owner
-- cannot be demoted or deactivated.
--
-- Deliberately strict about the service role: a service-role update
-- (auth.uid() is null) is ALSO refused. The set-user-active Edge Function
-- therefore updates profiles with the CALLING OWNER's JWT (this trigger and
-- RLS prove owner-ness) and uses the service role only for the Auth-level
-- ban/unban, which never touches this table.
-- ---------------------------------------------------------------------------
create or replace function public.tg_protect_profile_role()
returns trigger language plpgsql security definer set search_path = public, pg_temp
as $$
begin
  if (new.role is distinct from old.role or new.is_active is distinct from old.is_active)
     and not coalesce((select role = 'owner' and is_active
                       from public.profiles where id = auth.uid()), false) then
    raise exception 'Only an owner may change a user role or active status.';
  end if;

  if old.role = 'owner' and old.is_active
     and (new.role is distinct from 'owner' or not new.is_active)
     and not exists (select 1 from public.profiles p
                     where p.role = 'owner' and p.is_active and p.id <> old.id) then
    raise exception 'Cannot demote or deactivate the last active owner.';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Finding 1 (+4): storage policies.
--
-- documents bucket — path convention:
--   personal/<profile_id>/<file>  driver credentials & other person-scoped
--                                 files; readable by the subject and the
--                                 oversight roles (can_read_financials)
--   <entity_id>/<file>            org/vehicle files (unchanged layout);
--                                 readable by every ACTIVE authenticated user
-- Uploads into personal/ are limited to one's own prefix unless owner/manager.
--
-- receipts bucket — conscious keep: readable by every active authenticated
-- user (financial detail, but all tiers may read all expenses anyway); the
-- change here is only the is_active gate and is_admin()'s new active check.
-- ---------------------------------------------------------------------------
drop policy if exists "documents_read" on storage.objects;
create policy "documents_read" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documents'
    and public.is_active_user()
    and (
      public.can_read_financials()
      or split_part(name, '/', 1) <> 'personal'
      or split_part(name, '/', 2) = auth.uid()::text
    )
  );

drop policy if exists "documents_insert" on storage.objects;
create policy "documents_insert" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'documents'
    and public.can_write()
    and (
      public.can_edit_all()
      or split_part(name, '/', 1) <> 'personal'
      or split_part(name, '/', 2) = auth.uid()::text
    )
  );

drop policy if exists "documents_update" on storage.objects;
create policy "documents_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'documents'
         and (public.is_admin() or (public.is_active_user() and owner = auth.uid())))
  with check (bucket_id = 'documents');

drop policy if exists "documents_delete" on storage.objects;
create policy "documents_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'documents'
         and (public.is_admin() or (public.is_active_user() and owner = auth.uid())));

drop policy if exists "receipts_read" on storage.objects;
create policy "receipts_read" on storage.objects
  for select to authenticated
  using (bucket_id = 'receipts' and public.is_active_user());

drop policy if exists "receipts_update" on storage.objects;
create policy "receipts_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'receipts'
         and (public.is_admin() or (public.is_active_user() and owner = auth.uid())))
  with check (bucket_id = 'receipts');

drop policy if exists "receipts_delete" on storage.objects;
create policy "receipts_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'receipts'
         and (public.is_admin() or (public.is_active_user() and owner = auth.uid())));
