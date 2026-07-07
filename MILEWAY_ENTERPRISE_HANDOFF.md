# Mileway Enterprise — Build Handoff

**For:** the development agent picking up this build (Claude Fable 5, working through Claude Code).
**From:** the planning thread that scoped and reviewed Phases 1 and 2.
**Read this first, then read the repo.** This document is the intent, the current state, and the guardrails. The migration files and `README.md` in the repository are the source of truth for exact table names, column types, and code. Where the two disagree, the repo wins — and this document is wrong and should be corrected.

> **Accuracy status:** reconciled against the actual `README.md` on `main` (the merged Phase 1 + Phase 2 document), including the view and function names. The migrations and RLS have since been verified against a live database — see section 7 for what that found (four gaps, now being fixed in the `0011` hardening). The `0002_rls.sql:87` comment claiming `created_by` "can't be forged" is known-wrong; the code wins until `0011` fixes it.

---

## 1. What Mileway Enterprise is

A single operations platform that runs transportation, mileage, vehicles, expenses, reimbursement, compliance documentation, and reporting across two legal entities from one system.

It replaces a stack of disconnected tools: mileage-tracking apps, vehicle maintenance logs, reimbursement spreadsheets, expense spreadsheets, basic fleet software, transportation-compliance documentation, and — behind a privacy gate, in a later phase — resident transportation logs.

### The holistic end state ("done" looks like this)

- **One backbone for both entities.** A 501(c)(3) foundation and an LLC operate from the same platform. Every record is tagged to one entity; reporting works both per-entity and consolidated.
- **Audit-ready by construction.** Immutable timestamps, an append-only audit trail, and database-enforced access control that would hold up to a funder or regulatory review.
- **Mobile-first, then native.** Usable on the web today; architected so a Capacitor wrapper adds background GPS and push notifications without a rebuild.
- **No duplicate systems.** When the platform is complete, the entities run mileage, fleet, expenses, credentials, and (behind the gate) resident transportation from Mileway alone.

The residents domain is the last and most sensitive piece. It is deliberately not built yet. See section 11.

---

## 2. Architecture and stack

- **Frontend:** Vite + React 18 + TypeScript, single-page app, React Router. Capacitor-ready (not yet packaged) — a pure client-side SPA builds to static assets in `dist/`, which Capacitor can later wrap into native iOS/Android with no rearchitecting.
- **Backend:** Supabase — Postgres, Row-Level Security, Auth (email + Google), Storage (private buckets).
- **Data-model discipline:** all access control lives at the database layer via RLS, not only in the app. The app enforces the same rules a second time in route guards and per-record edit checks.

Use these libraries; don't introduce a parallel one for a job already covered.

| Concern | Choice |
|---|---|
| Frontend | Vite, React 18, TypeScript, React Router |
| UI | Tailwind CSS, lucide-react icons |
| Server state | TanStack Query, `@supabase/supabase-js` |
| Tables / charts | TanStack Table, Recharts |
| Export | SheetJS (`xlsx`) for multi-tab Excel; native CSV |
| Backend / data | Supabase: Postgres + RLS, Auth (email + Google), Storage |
| Mobile (later) | Capacitor wraps `dist/` |

---

## 3. The dual-entity model — the non-negotiable core

This is the one part that is expensive to retrofit and must never be compromised:

- A **501(c)(3) foundation** is the primary entity; an **LLC** is the operational arm beneath it.
- **Every** operational record — trip, vehicle, expense, maintenance record, document, location — is assignable to one entity.
- Reporting runs two ways: **filtered to a single entity**, and **consolidated across both**.

Any new table that holds operational data carries an `entity_id`. Shared resources (e.g., a location usable by both entities) use a nullable `entity_id` where null means "shared."

---

## 4. Current state — Phase 1 (built, verified by review, on default branch)

**Migrations `0001`–`0005`** (descriptive suffixes, e.g. `0001_schema.sql` holds triggers, `0002_rls.sql` holds the RLS policies).

### Schema
| Table | Purpose |
|---|---|
| `entities` | The two legal entities |
| `profiles` | Users and their role |
| `vehicles` | Fleet records incl. insurance/registration expiration dates |
| `trips` | Mileage logging |
| `expenses` | Expense capture |
| `trip_categories` | Editable lookup, 9 seeded; each maps to an `irs_rate_type` (business / medical / charitable / none) |
| `expense_categories` | Editable lookup, 6 seeded |
| `mileage_rates` | Date-effective IRS rates |
| `audit_log` | Append-only |

Plus: immutable `created_*` / auto `updated_*` triggers on every table; RLS enforcing the original three roles at the DB layer; two `security_invoker` views — `v_trip_details` and `v_expense_details` — that flatten joins and compute each trip's applied IRS rate and estimated deduction while respecting each user's RLS; a private `receipts` storage bucket; seed data (both entities, 9 trip categories, 6 expense categories, IRS rates); first user to sign up auto-bootstraps as the top admin role.

### App
- Email + Google auth; role-gated routes and UI.
- Trip logging (manual miles **or** odometer start/end).
- Vehicle records with insurance/registration expiration cues.
- Expense capture with receipt upload (file storage only, no OCR).
- Consolidated + per-entity dashboard: business miles MTD/YTD, miles by entity, fuel and vehicle costs, estimated IRS deduction, monthly chart.
- Reports: IRS mileage log, per-entity mileage, expense report. Filter by entity/date. Export to CSV and multi-tab Excel (Trips / Vehicles / Expenses).
- Audit-log viewer; admin Settings for entities, categories, rates, users.

---

## 5. Current state — Phase 2 (built, verified by review, on default branch)

**Migrations `0006`–`0010`, then a separate app commit.**

### Roles → five permission tiers
The three-role model was replaced with two separate fields:

- **`role` (permission tier):** `owner` · `manager` · `contributor` · `accountant` · `auditor`
- **`job_title`:** editable lookup with all nine titles (Super Administrator, Executive Director, Administrator, Program Manager, Transportation Coordinator, Employee, Driver, Read-Only Auditor, Accountant). Display and reporting only — carries no permissions.

| Tier | Access |
|---|---|
| `owner` | Everything, incl. user management + settings |
| `manager` | Read/write all operational data; no user management, no settings |
| `contributor` | Reads everything; creates records; edits/deletes only their own |
| `accountant` | Read all + financial reports/export; no operational edits |
| `auditor` | Read-only |

Migration mapping (preserves existing access): `administrator` → `owner` (renamed in place), `staff` → `contributor` (renamed in place), `auditor` → unchanged; `manager` and `accountant` added. First-signup auto-bootstrap now creates an `owner`. The role change propagated through the app: auth context, route guards, nav, and per-record edit checks (managers edit any operational record; contributors only their own).

### Locations and auto-categorization
- `saved_locations` (geofences): nullable `entity_id` (null = shared), name, type (editable lookup), lat/lng, `radius_meters`, `default_trip_category_id`, `is_active`.
- `trips` extended: `start_lat/lng`, `end_lat/lng`, `started_at`, `ended_at`, `route_polyline`, `distance_source` (`manual | odometer | gps`), `start_location_id`, `end_location_id`, `auto_categorized` (bool).
- On the web, picking a saved location on the trip form applies that location's default category and sets `auto_categorized`. A manual category change clears the flag. True GPS geofencing waits for the native app; the columns are in place for it.
- Helper functions `earth_distance_m()` and `find_location_for_point()` support point-in-location lookups — the groundwork for GPS auto-categorization in the native phase.

### Fleet maintenance
- `maintenance_types` (editable lookup, seeded).
- `maintenance_records`: `vehicle_id`, `entity_id` (default from vehicle), `maintenance_type_id`, `service_date`, `odometer_at_service`, `cost`, `vendor`, `notes`, `linked_expense_id` (ties a service to its expense instead of double entry).
- `maintenance_schedules`: `interval_miles` and/or `interval_months`, `last_service_date`, `last_service_odometer`, `is_active`.
- `v_maintenance_due` view computes "due" from the schedule against each vehicle's current odometer (itself a view, `v_vehicle_odometer`, derived from trips). Due is never stored.

### Documents and driver credentials
- `documents`: `entity_id` (required), `vehicle_id` (nullable), `profile_id` (nullable), title, `document_type` (editable lookup), `file_path`, `issued_date`, `expiration_date`, `tags` (text[]), notes.
  - Org doc = `vehicle_id` and `profile_id` both null. Vehicle doc = `vehicle_id` set. Driver-credential doc = `profile_id` set. No polymorphic owner table.
- Private `documents` storage bucket, parallel to `receipts`.
- `v_documents_expiring` view (documents with an expiration date, by time remaining) and `v_driver_credentials` view (per-person credential documents).
- Personal (per-person) documents are visible only to the subject and to oversight roles (`owner` / `manager` / `accountant` / `auditor`); organization and vehicle documents are visible to all authenticated users. **Caveat (until `0011` lands): this holds at the row level only — the `documents` storage bucket itself is readable by any authenticated user, so the files leak even though the rows are gated. See section 7, finding 1.**
- **Vehicle insurance/registration expiration stays on `vehicles` as the source of truth.** A document may attach the PDF, but the expiration date is not copied into `documents`, and `v_documents_expiring` does not double-count it.

### Dashboard, reports, settings
- Dashboard "Needs attention" panel: maintenance due, vehicle insurance/registration, expiring documents.
- Maintenance report added to Reports and to the Excel workbook.
- New editable lookups in Settings: job titles, location types, maintenance types, document types.
- Audit-log read is limited to `owner` / `accountant` / `auditor`.

---

## 6. Repository and branch state — read before you branch

Phase 1 and Phase 2 are merged (clean fast-forward), and the branch housekeeping is done. The repository now has a **single branch, `main`**, at commit `d2cd6e8`, holding all 10 migrations (`0001`–`0010`) and the full app — MaintenancePage / DocumentsPage / LocationsPage plus the updated dashboard, trips, and settings. The old auto-named default (`claude/gallant-goldberg-t5hoap`) was renamed to `main`; the redundant `claude/mileway-phase-2` was deleted. Branch off `main`.

No PR was opened for the merge; the fast-forward produced the same tree a PR would have, minus the reviewable diff. That review has not happened — see section 7.

**The repo `README.md` is rewritten to match `main`** — one coherent document covering the five permission tiers, the nine display-only job titles, all 10 migrations with the enum-ordering rule stated, and the Phase 2 domains (locations/geofences with auto-categorization, fleet maintenance, documents + driver credentials), with GPS/native, reminders, and residents confined to a "Not yet built" note. This has been reconciled against the actual README text on `main` — it matches this handoff, and the README's view and function names corrected a few in this document.

---

## 7. Current gate — verification is DONE; the 0011 hardening is the active task before Phase 3

**Read this before proposing any next step. Verification is complete. Do not re-run it or jump to Phase 3.** A fresh session that skips this section will wrongly conclude the review is still pending and drift straight to Phase 3 — which is the one wrong move here, because Phase 3 sits behind the hardening below.

**What was verified (done, by the Fable session):** all 10 migrations applied cleanly against a real Postgres 17 with a shimmed Supabase environment, each migration in its own transaction. The enum-ordering hazard is confirmed real (concatenating `0006`+`0007` fails with "unsafe use of new value manager"). Schema check passed — 17 tables, 6 views, both private buckets, all seed counts correct, RLS enabled on every public table. The full five-tier role matrix passed at the database, including the key case: a contributor's UPDATE/DELETE against a manager-created record touches 0 rows (refused). A throwaway *cloud* Supabase run is still worth doing later — it exercises real Auth + Storage, which the shim only approximates — but it is not blocking.

> Note for any manual re-test: an RLS refusal on UPDATE/DELETE looks like "0 rows affected," not an error. Check row counts, not error messages.

**Four gaps the verification found — none visible to app-level clicking, all real. Fixed by the `0011` hardening (in progress on its own branch):**

1. **Personal document *files* are not protected at the storage layer — most serious.** Document *rows* are gated, but the `documents` bucket is readable by any authenticated user, so a contributor can list and sign URLs for another person's credential files (e.g., a background check). This contradicts the README's promise that personal documents are visible only to subject + oversight roles — true at the row level, false at the file level. Fix: store personal (profile-scoped) docs under a `<profile_id>/…` path prefix and scope the bucket read policy to that prefix; includes an upload-path app change. Highest priority because Phase 3 reminders link people back to exactly these files, and the bucket is still empty (cheapest to fix pre-launch).

2. **`created_by` is forgeable on insert.** `tg_set_audit_fields` uses `coalesce(new.created_by, auth.uid())`, so a supplied value wins — a contributor can stamp a trip as created by someone else, corrupting the IRS mileage log's attribution. The `audit_log` still records the true actor. The comment at `0002_rls.sql:87` claiming it "can't be forged" is wrong (a real doc/code disagreement). Fix: flip to `coalesce(auth.uid(), new.created_by)`.

3. **Demoted users keep edit rights on their old records.** The own-record edit/delete arm has no write-tier guard, so a user demoted to auditor/accountant can still edit/delete everything they created before demotion. Fix: add a `can_write()` conjunct to the own-record arm.

4. **`is_active` is enforced by nothing.** "Deactivate" currently changes a badge only — a deactivated user keeps full write access and can flip themselves back on. **Decision made:** deactivated means no reads, no writes, cannot self-reactivate, and cannot access the system at all. Fix spans layers: fold `is_active` into the RLS helper functions (blocks read + write even with a valid token), trigger-protect `is_active` from self-edit (owner-only), sign out deactivated users in the app, and disable the Supabase Auth login on deactivation. Implement deactivate/reactivate as a single owner-only **service-role** action — the app's first server-side privileged path, isolated, never in the client.

**Also confirmed, leave as-is (called out, not bugs):** `saved_locations` / `maintenance_schedules` are owner/manager-write-only (fleet config vs. operational data — intended, keep); the `receipts` bucket is all-authenticated-readable (matches Phase 1 design, but carries financial detail — a conscious keep).

**The gate:** finish `0011` (schema-first, reviewed, applied, verification suite re-run green, merged) **before** Phase 3 reminders. The Fable session's verification scripts (shim, fixtures, matrix) should be committed to a branch as a reusable RLS regression suite. Once `0011` merges, reconcile the docs: the README's personal-document promise finally becomes true, and the `0002_rls.sql:87` comment is corrected.

---

## 8. Conventions every new table and feature must follow

This is the house style. New work that breaks it creates exactly the integration mess the phased approach exists to prevent.

- `created_*` (immutable) and `updated_*` (auto) triggers on every table.
- RLS on every table, matching the five permission tiers.
- `audit_log` coverage on every table.
- `security_invoker` views for anything computed. Never store a derived value (no stored "due," no stored "deduction").
- Editable lookup tables for anything enumerable, managed in Settings.
- Date-effective rows where a value changes over time (e.g., mileage rates).
- Seed data for lookups.
- Every operational record carries `entity_id`.
- American English; plain, direct UI labels.
- User-facing copy uses person-first, non-stigmatizing language. Never "clean" for abstinent, never "compliance" for a person's participation.

---

## 9. Flagged defaults awaiting Jeff's confirmation

All are editable in-app; none block Phase 3, but confirm before treating any as final.

1. **2026 business/medical IRS rates are placeholders** copied from 2025. Charitable 14¢ is statutory. Verify in Settings → Mileage rates.
2. **Category → rate-type mapping** (e.g., Pharmacy → medical, Fundraising → charitable). Confirm with Jeff's tax advisor.
3. **Entity legal names / EINs are placeholders.** Set in Settings → Entities.
4. **Expiration look-ahead = 60 days** (`EXPIRATION_WINDOW_DAYS` constant) for the dashboard and Documents "expiring" surfaces. **Phase 3 (reminders) replaces this constant with configurable per-type lead times** — so it gets resolved there, not as a separate task. A driver's license renewal and a vehicle registration warrant different lead times.
5. **Web auto-categorization** fires on saved-location pick only; GPS geofencing waits for native.
6. **Audit-log read** = `owner` / `accountant` / `auditor`.

---

## 10. Roadmap — remaining phases

In recommended order:

1. **Verification — DONE.** The migrations, RLS, and five-tier matrix are verified against a live database (section 7). It surfaced four gaps now being fixed in the **`0011` hardening** (storage file scoping, forgeable `created_by`, demoted-user edit rights, `is_active` deactivation). `0011` is the blocking gate — finish and merge it before Phase 3. A throwaway cloud-Supabase run is still worth doing but is not blocking.
2. **Automated reminders (email) — the active Phase 3.** Selected direction. Turn the existing due/expiring signals (`v_maintenance_due`, `v_documents_expiring`, `v_driver_credentials`, vehicle expiration fields) into a scheduled digest email via a server-side job (e.g., Supabase Edge Function on a schedule + an email provider). Adds a delivery layer on top of what already computes. Two settled design calls: a single digest (not one email per item), and minimal detail in the body (category + link back into the app, never a named person's credential or document contents in plaintext — the in-app access gates must hold). Replace the hardcoded `EXPIRATION_WINDOW_DAYS` with configurable per-type lead times. The scheduled job runs with elevated privilege (service role, bypassing RLS) — isolate that path and keep the service role off the client.
3. **Native GPS capture** via Capacitor packaging: background location, geofence-by-GPS auto-categorization, push notifications. The trip GPS columns and the `find_location_for_point()` helper already exist for this. Deferred behind reminders — bigger lift (native build/deploy, background-location permissions) and a longer maintenance tail.
4. **Accounting / payroll / banking integrations** (e.g., QuickBooks, Xero). Currently a deliberate exclusion; lift only when Jeff decides.
5. **Incident reporting.**
6. **OCR** for receipts and documents (storage exists; add extraction).
7. **Residents / appointments domain — GATED. See section 11.**

---

## 11. The residents module — hard gate

**Do not scaffold resident, appointment, or waiver/funding-source tables in a normal build pass.**

A resident transportation record ties a person — even by initials — to behavioral-health or substance use disorder appointments, a funding source, and a waiver program. That is arguably **42 CFR Part 2** data and likely **PHI**. A fast-built module holding it will not survive an audit unless the data model, access controls, and hosting are designed for that from the start, not bolted on after.

This phase starts with a **data-handling design** conversation, not a schema: where the data lives, who can reach it, how access is controlled, hosting posture, retention. It is an open question whether it should even share a database with a mileage tracker or run as a separate, locked-down system.

Until that design is settled: no resident tables, and no real resident data in any environment. If asked to build it anyway, stop and route back to Jeff.

---

## 12. How this build has been run

Keep this method — it is why two phases landed clean and reversible:

- **Schema first.** Propose the full schema for a phase, present it for review, and **stop for human approval before writing any UI or logic.**
- **One phase = one branch = one PR**, merged in order.
- **Verify migrations on staging before building on top of them.**
- **Narrow and deep, not broad and thin.** Do not scaffold the whole spec at once.
- **Confirm before anything irreversible** (merges, destructive migrations, live data).

---

## 13. Setup / run

1. `npm install`
2. Create a Supabase project.
3. Run migrations `0001` → `0010` in order (`0006` before `0007`, for the enum commit).
4. Set `.env` (Supabase URL + anon key).
5. Configure Google + email auth providers.
6. `npm run dev`

Full steps are in `README.md`.

### Project layout

```
supabase/migrations/   SQL: schema, RLS, views, seed, storage (0001–0010)
src/
  lib/                 supabase client, utils, metrics, export (csv/excel/reports)
  contexts/            AuthContext (session + profile + role)
  hooks/               TanStack Query data hooks (one per domain)
  components/
    ui/                primitives (button, input, modal, …)
    common/            DataTable, EntityFilter, StatCard, …
    forms/             Trip, Vehicle, Expense, SavedLocation, MaintenanceRecord,
                       MaintenanceSchedule, Document
    settings/          admin settings sections (entities, categories, rates, lookups, users)
    layout/            AppLayout (sidebar + topbar)
    auth/              route guards
  pages/               Dashboard, Trips, Vehicles, Maintenance, Expenses, Locations,
                       Documents, Reports, Audit, Settings, Login
```

**Types:** `npm run db:types` regenerates `src/types/supabase.ts` from a linked Supabase project (requires the Supabase CLI). Hand-written row types live in `src/types/db.ts`.

---

## 14. Quick start for the next agent

1. Read `README.md` and migrations `0001`–`0010` in the repo. Treat them as source of truth; reconcile any drift against this document.
2. Confirm the branch state in section 6 — everything is on a single `main`; no merges are pending.
3. Verification is done (section 7); the active task is the **`0011` hardening** branch that fixes the four findings. Don't re-run verification or jump to Phase 3. A throwaway cloud-Supabase run to exercise real Auth/Storage is still worth doing but isn't blocking.
4. The next phase is **automated reminders (email)** — the chosen Phase 3 (section 10). A scheduled digest built on the existing due/expiring views, with minimal detail in the body. **Not residents.**
5. Hold the conventions in section 8 and the method in section 12. Schema first, human approves, one PR per phase.
