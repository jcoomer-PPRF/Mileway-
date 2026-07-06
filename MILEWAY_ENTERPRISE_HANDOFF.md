# Mileway Enterprise — Build Handoff

**For:** the development agent picking up this build (Claude Fable 5, working through Claude Code).
**From:** the planning thread that scoped and reviewed Phases 1 and 2.
**Read this first, then read the repo.** This document is the intent, the current state, and the guardrails. The migration files and `README.md` in the repository are the source of truth for exact table names, column types, and code. Where the two disagree, the repo wins — and this document is wrong and should be corrected.

> **Accuracy status:** reconciled against the actual `README.md` on `main` (the merged Phase 1 + Phase 2 document), including the view and function names. The migration SQL itself has not been read line-by-line — for exact columns and RLS predicates, read the migration files before building on them.

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
- Personal (per-person) documents are visible only to the subject and to oversight roles (`owner` / `manager` / `accountant` / `auditor`); organization and vehicle documents are visible to all authenticated users.
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

## 7. Do this first — before any new feature

The code is merged, but none of it has touched a database yet, and the merge skipped the diff review. Close both gaps before building anything new.

1. **Apply the migrations to Supabase — the real gate.** Everything so far is verified by `tsc` and review of the *plan*, not the generated SQL, and the SQL has never run. Apply `0001` → `0010` **in order**, on a throwaway/staging project first — not one you care about.
   - **Enum-ordering hazard:** `0006` must commit the new role enum values before `0007` uses them. Postgres will not add an enum value and use it in the same transaction. Apply each migration file as its own step — in the Supabase SQL Editor, run them one file at a time, not all pasted together — so `0006` commits before `0007` runs.
   - **Role migration converts existing user records.** After applying, sign in as each of the five tiers and confirm an existing user kept the access they had. This is the only change in the build that can silently strip access.
2. **Do the review the fast-forward merge skipped.** No PR diff was ever looked at. Read `0006` and `0007` (the role/RLS migration) against the code before trusting them in any environment with real data. This is the single riskiest file in the build.
3. **README** — rewritten to match Phase 2 and reconciled against the file on `main`. Done. The branch rename to `main` and the redundant-branch deletion are also done.
4. Only after the schema is applied, verified, and reviewed, start the next roadmap item.

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

1. **Verify** (section 7): apply migrations on a throwaway Supabase, read `0006`/`0007`, run the role test. Blocking — do before Phase 3. (Branch housekeeping and README are done.)
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
3. Stand up a throwaway Supabase, apply migrations `0001`–`0010` in order one at a time, and sign in as each of the five tiers to confirm access enforces at the database (section 7). Fix any RLS or enum-ordering issue before anything new.
4. The next phase is **automated reminders (email)** — the chosen Phase 3 (section 10). A scheduled digest built on the existing due/expiring views, with minimal detail in the body. **Not residents.**
5. Hold the conventions in section 8 and the method in section 12. Schema first, human approves, one PR per phase.
