-- ============================================================================
-- Mileway — Row Level Security
-- Three roles: administrator (full), staff (read all / write own), auditor (read).
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Role helper functions (SECURITY DEFINER → read profiles without RLS recursion)
-- ---------------------------------------------------------------------------
create or replace function public.current_user_role()
returns public.user_role
language sql stable security definer
set search_path = public, pg_temp
as $$ select role from public.profiles where id = auth.uid(); $$;

create or replace function public.is_admin()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$ select coalesce((select role = 'administrator' from public.profiles where id = auth.uid()), false); $$;

-- administrator OR staff (i.e. allowed to create records)
create or replace function public.can_write()
returns boolean
language sql stable security definer
set search_path = public, pg_temp
as $$ select coalesce((select role in ('administrator','staff') from public.profiles where id = auth.uid()), false); $$;

-- ---------------------------------------------------------------------------
-- Base grants (RLS still gates every row; table privileges are necessary but
-- not sufficient — a table with RLS on and no matching policy denies access).
-- ---------------------------------------------------------------------------
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere
-- ---------------------------------------------------------------------------
alter table public.profiles            enable row level security;
alter table public.entities            enable row level security;
alter table public.vehicles            enable row level security;
alter table public.trip_categories     enable row level security;
alter table public.expense_categories  enable row level security;
alter table public.mileage_rates       enable row level security;
alter table public.trips               enable row level security;
alter table public.expenses            enable row level security;
alter table public.audit_log           enable row level security;

-- ---------------------------------------------------------------------------
-- profiles: everyone reads (to resolve names); self or admin may update.
-- Inserts happen via the handle_new_user trigger; no deletes (deactivate).
-- Role changes are additionally guarded by tg_protect_profile_role.
-- ---------------------------------------------------------------------------
create policy profiles_select on public.profiles
  for select to authenticated using (true);
create policy profiles_update on public.profiles
  for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------------
-- Admin-managed reference tables: everyone reads, only admins write.
-- ---------------------------------------------------------------------------
create policy entities_select on public.entities
  for select to authenticated using (true);
create policy entities_admin_write on public.entities
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy trip_categories_select on public.trip_categories
  for select to authenticated using (true);
create policy trip_categories_admin_write on public.trip_categories
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy expense_categories_select on public.expense_categories
  for select to authenticated using (true);
create policy expense_categories_admin_write on public.expense_categories
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy mileage_rates_select on public.mileage_rates
  for select to authenticated using (true);
create policy mileage_rates_admin_write on public.mileage_rates
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Operational records: read all; create if staff/admin; edit/delete own or admin.
-- (created_by is set by tg_set_audit_fields. NOTE: as originally written the
-- trigger kept a client-supplied created_by — forgeable; 0011 flips the
-- coalesce so authenticated inserts cannot supply one.)
-- ---------------------------------------------------------------------------
create policy vehicles_select on public.vehicles
  for select to authenticated using (true);
create policy vehicles_insert on public.vehicles
  for insert to authenticated with check (public.can_write());
create policy vehicles_update on public.vehicles
  for update to authenticated
  using (public.is_admin() or created_by = auth.uid())
  with check (public.is_admin() or created_by = auth.uid());
create policy vehicles_delete on public.vehicles
  for delete to authenticated using (public.is_admin() or created_by = auth.uid());

create policy trips_select on public.trips
  for select to authenticated using (true);
create policy trips_insert on public.trips
  for insert to authenticated with check (public.can_write());
create policy trips_update on public.trips
  for update to authenticated
  using (public.is_admin() or created_by = auth.uid())
  with check (public.is_admin() or created_by = auth.uid());
create policy trips_delete on public.trips
  for delete to authenticated using (public.is_admin() or created_by = auth.uid());

create policy expenses_select on public.expenses
  for select to authenticated using (true);
create policy expenses_insert on public.expenses
  for insert to authenticated with check (public.can_write());
create policy expenses_update on public.expenses
  for update to authenticated
  using (public.is_admin() or created_by = auth.uid())
  with check (public.is_admin() or created_by = auth.uid());
create policy expenses_delete on public.expenses
  for delete to authenticated using (public.is_admin() or created_by = auth.uid());

-- ---------------------------------------------------------------------------
-- audit_log: admins and auditors may read; NOBODY may write through the API.
-- (The SECURITY DEFINER trigger tg_write_audit bypasses RLS to append rows.)
-- ---------------------------------------------------------------------------
create policy audit_log_select on public.audit_log
  for select to authenticated
  using (public.is_admin() or public.current_user_role() = 'auditor');
