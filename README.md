# Mileway

Internal operations app for a two-entity organization — a **501(c)(3) foundation** (primary)
and an **operating LLC** beneath it. Mileway handles **mileage logging, vehicle and
fleet-maintenance records, expense capture, saved locations, and a document/credential store**,
with consolidated and per-entity reporting plus an immutable audit trail.

---

## Tech stack

A **Vite + React + TypeScript single-page app** backed by **Supabase** (hosted Postgres, Auth,
Storage). A pure client-side SPA builds to static assets, so the same build can later be wrapped
by **Capacitor** into native iOS/Android with no rearchitecting. Supabase provides email + Google
auth, private file storage (receipts + documents), and **row-level security that enforces the five
roles at the database layer** — defense-in-depth that matters for an auditor-facing app.

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

## Getting started

### 1. Install

```bash
npm install
```

### 2. Create a Supabase project

1. Create a project at <https://supabase.com>.
2. In **Project Settings → API**, copy the **Project URL** and **anon public key**.
3. Copy the env template and fill it in:

   ```bash
   cp .env.example .env
   # edit .env:
   # VITE_SUPABASE_URL=...
   # VITE_SUPABASE_ANON_KEY=...
   ```

### 3. Apply the database schema

Run the migrations in `supabase/migrations/` **in order, one at a time** (`0001` → `0011`).
**Do not paste several files into a single SQL Editor run:** migration **`0006` adds the new role
enum values and `0007` uses them**, and Postgres cannot add *and* use an enum value in the same
transaction — so `0006` must commit before `0007` runs. Either:

- **Supabase Dashboard → SQL Editor**: paste each file’s contents and run it, one file at a time,
  in numeric order; or
- **Supabase CLI** (applies each migration in order, each in its own transaction):

  ```bash
  supabase link --project-ref <your-ref>
  supabase db push
  ```

The migrations create every table (entities, vehicles, trips, expenses, saved locations,
maintenance, documents, and their lookups), RLS policies, audit triggers, and reporting views;
create the private **`receipts`** and **`documents`** storage buckets; and seed the two entities,
IRS mileage rates, and the editable lookups (trip/expense categories, job titles, and
location / maintenance / document types).

### 4. Configure auth providers

- **Email**: enabled by default. For the fastest internal setup, turn **off** "Confirm email"
  under **Authentication → Providers → Email** (or just use Google).
- **Google**: **Authentication → Providers → Google**, add your Google OAuth client ID/secret,
  and add your app origin (e.g. `http://localhost:5173`) to **Authentication → URL Configuration →
  Redirect URLs**.

### 5. Deploy the deactivation function

Account deactivation runs through a small Edge Function — the app's only service-role
path. It flips `profiles.is_active` as the calling owner (the database proves owner-ness)
and bans/unbans the Supabase Auth account so a deactivated user cannot sign in at all.

```bash
supabase link --project-ref <your-ref>   # if not already linked
supabase functions deploy set-user-active
```

Without it, the Status field in **Settings → Users** errors on save; everything else works.

### 6. Run

```bash
npm run dev      # http://localhost:5173
npm run build    # typecheck + production build to dist/
npm run preview  # serve the production build
```

> **First account = Owner.** The first user to sign up is automatically made the **Owner**
> (bootstrap). Everyone after that defaults to **Contributor**; change roles in
> **Settings → Users**.

---

## Roles & job titles

Identity is split into two independent fields on each user:

- **Job title** — display/reporting only, with **no bearing on permissions**. Nine titles are
  seeded and the list is editable in **Settings → Job titles**: Super Administrator, Executive
  Director, Administrator, Program Manager, Transportation Coordinator, Employee, Driver,
  Read-Only Auditor, Accountant.
- **Role (permission tier)** — governs access. Five tiers:

| Tier | Access |
|---|---|
| **Owner** | Full access, including settings and user management. |
| **Manager** | Read/write **all** operational data. No settings or user management. |
| **Contributor** | Reads everything; creates records; edits/deletes **only the records they created**. |
| **Accountant** | Reads everything (incl. audit log) and runs/exports reports. No operational edits. |
| **Auditor** | Read-only access to all records **and the audit log**. No writes. |

Enforcement is twofold: the UI hides actions a role can’t take, and **Postgres RLS policies**
enforce the same rules at the database — the API rejects unauthorized writes regardless of the
client. The first account to sign up bootstraps as **Owner**; everyone after defaults to
**Contributor**.

Hardening rules (migration `0011`) that apply across all tiers:

- `created_by` / `created_at` are **server-set** — an authenticated insert cannot supply them.
- The own-record edit rule requires a **current** write-tier role: a user moved to Auditor or
  Accountant loses edit/delete on records they created earlier.
- **Deactivation is real.** An owner deactivating an account (Settings → Users) blocks
  sign-in at the Auth layer (via the `set-user-active` Edge Function) and, for any
  still-valid token, every read and write at the database. Deactivated users see a
  deactivated-account message, cannot reactivate themselves, and only an owner can restore
  them. The last active owner can never be demoted or deactivated.
- Enforcement is verified by an executable test suite in `supabase/tests/` (60 checks).

---

## Features

### Trips & mileage
Manual trip logging — date, vehicle, category, entity, and distance entered directly or computed
from odometer start/end. Trip categories are editable and each maps to an `irs_rate_type`
(business / medical / charitable / none); the date-effective rate is applied to compute an
estimated deduction. Optional **start / end saved-location pickers** drive **auto-categorization**:
choosing a saved location applies that location’s default trip category, and a manual category
change clears the auto-categorized flag. Trips also carry GPS/location columns in the schema
(start/end lat-lng, timestamps, route, saved-location references).

### Vehicles
VIN, plate, year/make/model, odometer, and insurance & registration with expiration dates.

### Expenses
Amount, date, category, entity, optional vehicle link, and an optional receipt image stored in the
private `receipts` bucket (file only — **no OCR**).

### Locations (geofences)
Saved locations with coordinates, a radius, a location type, an optional owning entity
(or shared across both), and a default trip category that powers auto-categorization. Location
types are editable (seeded: Home, Group Home, Hospital, Pharmacy, County Office, Day Program,
Employment Site, Vendor).

### Fleet maintenance
Service **records** (type, date, odometer, cost, vendor, optional link to an expense), per-vehicle
**schedules** with mileage and/or month intervals, and a computed **due** view that flags what’s
due or overdue using each vehicle’s current odometer (derived from trips) and last service.
Maintenance types are editable (seeded: Oil Change, Tire Rotation, Brake Service, Repair,
Inspection, Registration Renewal, Insurance Renewal).

### Documents & driver credentials
A central store for documents scoped to the **organization**, a **vehicle**, or a **person**, each
with a type, issue/expiration dates, tags, and an uploaded file in the private `documents` bucket.
**Personal (per-person) documents are visible only to the subject and to oversight roles**
(owner / manager / accountant / auditor); organization and vehicle documents are visible to all
authenticated users. This holds for the **files as well as the rows**: person-scoped files are
stored under a `personal/<profile_id>/…` path and the storage policies gate reads on that prefix,
so a non-oversight user cannot list or sign a URL for another person's credential file. Expiration tracking and a driver-credentials view surface upcoming and lapsed
credentials. Document types are editable (seeded: Bylaws, IRS Determination Letter, Insurance
Policy, Policy / Procedure, Vehicle Title, Registration Document, Insurance Card, Driver License,
Insurance Verification, Background Check, Training / Safety Certificate, Other).

### Dashboard
Business miles (month + YTD), miles by entity, vehicle & fuel costs, and estimated IRS mileage
deduction — plus a **Needs attention** panel surfacing maintenance due, upcoming vehicle
insurance/registration expirations, and expiring documents (in-app only).

### Settings (owner only)
Entities, trip categories, expense categories, mileage rates, and the lookups — location types,
maintenance types, document types, and job titles — plus **Users** (role and job title).

### Audit
Every insert/update/delete on every table is mirrored to an append-only `audit_log`, readable by
owner, accountant, and auditor.

---

## Data model

All tables carry immutable `created_at` / `created_by` and auto-maintained `updated_at` /
`updated_by` (triggers in `0001_schema.sql`), and every change is mirrored into an append-only
`audit_log`.

**Core**

- **entities** — the two legal entities (Foundation = primary, Operating LLC). Every record
  references one.
- **profiles** — users (1:1 with `auth.users`), carrying `role`, optional `job_title_id`, and an
  optional default entity.
- **vehicles** — VIN, plate, year/make/model, odometer, insurance & registration (with expirations).
- **trip_categories** — editable; each maps to an `irs_rate_type` (business/medical/charitable/none).
- **expense_categories** — Fuel, Repairs, Maintenance, Parking, Tolls, Supplies (stable `key`).
- **mileage_rates** — date-effective IRS rates per type; the rate effective on a trip’s date applies.
- **trips** — date, vehicle, category, entity, distance (entered or from odometer), notes, plus
  GPS/location fields (start/end lat-lng, timestamps, route, saved-location refs, `auto_categorized`).
- **expenses** — amount, date, category, entity, optional vehicle, optional receipt file.
- **audit_log** — immutable who/when/what (old & new JSON) for every insert/update/delete.

**Locations, maintenance & documents**

- **job_titles** — editable job-title lookup (display/reporting only).
- **location_types** / **saved_locations** — geofence lookup + saved locations (coords, radius,
  default trip category; `entity_id` NULL = shared across both entities).
- **maintenance_types** / **maintenance_records** / **maintenance_schedules** — service catalog,
  service history, and per-vehicle interval schedules.
- **document_types** / **documents** — document catalog + the document store (org/vehicle/person
  scope, issue/expiration dates, tags, file).

**Views** (all `security_invoker`, so each user’s RLS still applies)

- **v_trip_details**, **v_expense_details** — flatten joins; `v_trip_details` also computes the
  applied rate + estimated deduction.
- **v_vehicle_odometer** — current odometer per vehicle, derived from trips.
- **v_maintenance_due** — schedules joined to odometer + last service to flag due/overdue.
- **v_documents_expiring** — documents with an expiration date, ordered by time remaining.
- **v_driver_credentials** — per-person credential documents.

Geofence helpers `earth_distance_m()` / `find_location_for_point()` support point-in-location
lookups.

---

## Reports & export

- **IRS-format mileage log**, **per-entity mileage summary**, **expense report**, and
  **maintenance report** — filterable by entity (single or consolidated) and date range.
- Export any report to **CSV**, or to **Excel**. The **Full workbook** export produces one `.xlsx`
  with separate **Trips / Vehicles / Expenses / Maintenance** tabs.

---

## Decisions & assumptions to confirm

- **IRS rates** are seeded as editable, date-effective defaults. Charitable is statutory (14¢);
  the **2026 business/medical rows are placeholders** copied from 2025 — verify against current IRS
  guidance in **Settings → Mileage rates**.
- **Category → rate-type mapping** (e.g. Pharmacy → medical, Fundraising → charitable) is a sensible
  default; confirm classifications with your tax advisor in **Settings → Trip categories**.
- **Contributors read everything** (shared operational picture) but write only their own records.
- **Expense → vehicle is optional** (covers non-vehicle costs like general supplies).
- Entity **legal names / EINs** are placeholders — set them in **Settings → Entities**.

---

## Not yet built

Native GPS capture / automatic trip recording (the schema carries GPS + geofence fields and a
`find_location_for_point()` helper, but today distance is entered manually and categories are
applied via location selection); automated email/push reminders (expirations and due items are
surfaced in-app only); and a residents / appointments / funding module. No OCR; no
accounting / payroll / banking integrations.

---

## Project layout

```
supabase/migrations/   SQL: schema, RLS, views, seed, storage, hardening (0001–0011)
supabase/functions/    Edge Functions: set-user-active (deactivation + Auth ban)
supabase/tests/        executable RLS verification suite (shim, fixtures, role matrix)
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

> `npm run db:types` regenerates `src/types/supabase.ts` from a linked Supabase project
> (requires the Supabase CLI). Hand-written row types live in `src/types/db.ts`.
