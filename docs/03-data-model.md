# Data Model

**Resolves:** P0-5, P0-7, P0-8, P1-18
**Prototype schema:** `apps/api/migrations/001_init.sql` (SQLite dialect, ADR-009)
**Production schema:** `apps/api/migrations-postgres/*.sql` (PostgreSQL dialect, implemented
15 August 2026 — see `docs/13-sqa-defect-report.md` §17 for the migration writeup and what
deliberately differs from §3 below). `db.ts` picks the backend automatically based on whether
`DATABASE_URL` is set; both share the same `Repo` class and SQL text.

---

## 1. What the source ERD was missing

The source ERD shows four entities: `EMPLOYEE`, `ATTENDANCE`, `LEAVE_REQUEST`, `PAYROLL_LOG`.
Six advertised modules need roughly twenty-four. The four critical omissions:

| Missing | Consequence |
|---|---|
| **`organisation_id` on every table** | A multi-tenant SaaS with no tenant key leaks customer data. **P0-5.** |
| **`leave_ledger`** | Balance stored as a mutable column drifts under concurrent approvals. **P0-7.** |
| **`payslip_line`** | `net_pay` alone cannot be audited or disputed. **P0-8.** |
| **`app_user` separate from `employee`** | A login is not a personnel record. Contractors have logins without employee rows; ex-employees have employee rows without logins. |

## 2. Entity map

```
organisation ─┬─< department ──< employee
              ├─< app_user ──< session
              └─< holiday

employee ─┬─< salary_structure     (effective-dated, never overwritten)
          ├─< attendance           (unique per employee per business date)
          ├─< leave_request ──< leave_ledger
          ├─< payslip ──< payslip_line       (immutable)
          └─< attrition_score ──< attrition_contribution

audit_log   (every write; every attrition-score view)
```

Deferred to Increment 3 and specified but not built in the prototype:
`okr_objective`, `okr_key_result`, `review_cycle`, `review_score`, `job_requisition`,
`candidate`, `application`, `application_stage_event`, `notice_receipt`, `tax_slab`.

## 3. Production PostgreSQL DDL — the parts that differ from the prototype

The prototype uses SQLite. These are the PostgreSQL-only constructs that must be added on
migration, and the reason each exists.

> **Implementation note (15 August 2026):** this section was written before the PostgreSQL
> migration existed, as a forward-looking design note. Now that `migrations-postgres/` is
> real, three of the four items below were deliberately built *differently* than written
> here, for reasons that only became concrete during implementation — each is annotated
> where it applies. Payslip immutability (the trigger) was built exactly as designed.
> Row-Level Security and the leave-overlap exclusion constraint are both still open — see
> `docs/13-sqa-defect-report.md` §17 for the full reasoning and status of everything in this
> section, not just the money/timestamp deviations.

### Tenant isolation (ADR-003)

```sql
ALTER TABLE employee ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON employee
  USING (organisation_id = current_setting('pulsehr.current_org')::uuid);
```

Repeat for every business table. The repository layer sets `pulsehr.current_org` from the
authenticated principal at the start of each transaction. RLS is the **backstop**, not the
primary control — two independent controls, because a cross-tenant leak ends a B2B product.

**Status: not yet built.** The primary control (every `Repo` query scoped by `organisation_id`,
ADR-003) is unchanged and still the enforced boundary — confirmed still holding by NFR-14's
tenant-isolation checks in `smoke.mjs`/`bughunt.mjs` against the Postgres-backed `Repo` class
via the same code path as SQLite. RLS as the second, defense-in-depth control is genuinely
deferred, not silently dropped — tracked here rather than closed out.

### Overlapping leave (P0-7)

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE leave_request ADD CONSTRAINT no_overlapping_approved_leave
  EXCLUDE USING gist (
    employee_id WITH =,
    daterange(start_date, end_date, '[]') WITH &&
  ) WHERE (status = 'APPROVED');
```

SQLite has no exclusion constraints, so the prototype enforces this inside the approval
transaction. In production, both apply — the constraint catches anything that bypasses the
application.

**Status: not yet built**, same reasoning as Row-Level Security above — the application-level
guard (checked inside the approval transaction, `server.ts`'s leave-decision route) is the
primary control and is proven working against Postgres by `smoke.mjs`'s P0-7 check
(concurrent-approval race). The `EXCLUDE USING gist` constraint remains a real improvement to
make, as a second independent control, not a requirement for the application guard to be
correct.

### Payslip immutability (P0-8, NFR-9)

```sql
CREATE OR REPLACE FUNCTION reject_payslip_update() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'payslip is immutable — issue an adjustment payslip instead';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER payslip_immutable BEFORE UPDATE ON payslip
  FOR EACH ROW EXECUTE FUNCTION reject_payslip_update();
```

The prototype implements the equivalent SQLite trigger, and it is verified to fire.

**Status: built as designed.** `migrations-postgres/001_init.sql` creates
`reject_payslip_update()`/`reject_payslip_line_update()` plus their `BEFORE UPDATE` triggers,
in PL/pgSQL, exactly this pattern.

### Money

```sql
-- Prototype: INTEGER paisa. Production: NUMERIC(14,2) taka.
-- Never FLOAT/REAL. 0.1 + 0.2 != 0.3 in binary floating point, and accumulating that
-- error across payslip lines produces the one-taka disputes that destroy trust.
ALTER TABLE payslip ALTER COLUMN net_pay TYPE NUMERIC(14,2);
```

**Status: built differently, deliberately.** Money stays **INTEGER paisa** in
`migrations-postgres/`, the same representation SQLite already uses — not `NUMERIC(14,2)`.
The FLOAT/REAL warning above is correct and the reason still holds; the fix doesn't have to be
NUMERIC, and NUMERIC introduces a real problem of its own: `pg` (node-postgres) returns
NUMERIC columns as **strings**, not JS numbers, specifically to avoid silently losing
precision on values a JS `number` can't represent exactly. Every money value in this codebase
(`@pulsehr/core`, every `Repo` method, every route) is already written assuming a JS number
straight off the row — switching to NUMERIC would silently turn every one of those into a
string and break arithmetic throughout, unless every call site were also rewritten to parse
it back. INTEGER paisa avoids the float-precision problem the original note was correctly
worried about (it's still exact integer arithmetic, just in the smaller unit) without
introducing a second, larger problem. Confirmed round-tripping as a real JS number against
Postgres in `apps/api/src/verify-postgres-adapter.mjs`.

### Timestamps

```sql
-- ADR-005: every instant is TIMESTAMPTZ. Business dates are DATE, always derived in
-- Asia/Dhaka by the application, never by the database's session timezone.
ALTER TABLE attendance ALTER COLUMN check_in TYPE TIMESTAMPTZ;
```

**Status: built differently, deliberately**, for the same class of reason as money above.
Timestamps stay **TEXT** (ISO-8601 strings, exactly what `nowIso()` already produces and what
SQLite already stores) rather than `TIMESTAMPTZ` — `pg` returns `TIMESTAMPTZ` as a JS `Date`
object, not the string every call site compares, slices, and serialises today. All business-
date logic already lives in the application layer (`@pulsehr/core`'s `businessDate()` derives
Asia/Dhaka dates from JS, per ADR-005) — the database was never doing timezone-aware date
arithmetic in SQL to begin with, so `TIMESTAMPTZ`'s actual benefit (correct timezone-aware
comparisons *in SQL*) isn't something this schema currently uses. Confirmed no SQL-level date
function (`strftime`, `julianday`, `date()`) exists anywhere in `repo.ts` before choosing this.

## 4. Indexing

| Index | Supports |
|---|---|
| `attendance(organisation_id, employee_id, work_date)` | Monthly attendance grid — the hot path (P1-23) |
| `leave_ledger(employee_id, leave_type, effective_date)` | Balance = SUM(delta), computed on every read |
| `attrition_score(organisation_id, scored_on, score DESC)` | Top-N at-risk dashboard query |
| `payslip(organisation_id, period_year, period_month)` | Payroll register |
| `session(user_id)` | Bulk revocation on termination (ADR-006) |

`attrition_score` grows fastest — one row per employee per night. Partition it by month
once a tenant passes ~2,000 employees. Flagged now so it is not a surprise later.

## 5. Normalisation

The schema is in **3NF**, as the proposal commits to. Two deliberate, documented exceptions:

1. **`payslip.gross` / `total_deductions` / `net_pay`** are derived from `payslip_line` but
   stored anyway. Justification: payslips are immutable, so the derived values can never
   drift, and the payroll register would otherwise aggregate millions of line rows on every
   read. The values are **asserted against the lines before insert** — a payslip that does
   not add up is never persisted.
2. **`attendance.late_minutes`** is derivable from `check_in` and the shift start. Stored
   because the attrition feature pipeline aggregates it across 60-day windows for every
   employee nightly, and recomputing it each time is wasteful.

Both are denormalisations for read performance on **immutable or append-only** data, which
is the only situation where denormalisation is safe. Neither introduces an update anomaly,
because neither is ever updated.

## 6. Retention

| Data | Retention | Reason |
|---|---|---|
| Payslips, ledger | **7 years** | Statutory financial record |
| Attendance | 3 years | Operational + attrition feature windows |
| `attrition_score` | **25 months** | Enough for a year-over-year comparison (spec §9) |
| Feature values | **13 months** | Data minimisation |
| `audit_log` — payroll | 7 years | Matches the payroll record |
| `audit_log` — access | 2 years | Security investigation window |
| `session` | 30 days after expiry | Forensics |
