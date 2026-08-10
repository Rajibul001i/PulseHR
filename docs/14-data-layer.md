# Data Layer Design & Justification

**Owner:** Md. Jakariya — Database Administrator
**Covers:** schema, normalisation, indexing, query strategy, migrations, retention
**Companion:** [`03-data-model.md`](03-data-model.md) holds the DDL; this document explains
*why* it looks the way it does.

---

## 1. From 18 analysis classes to 24 tables

Our Requirements Model settled on **18 core analysis classes** after filtering 45 candidate
nouns. The physical schema has more tables than that, and the difference is deliberate.

| Analysis class | Physical tables | Why the difference |
|---|---|---|
| `Person` (abstract) | *(none)* | An abstract class with no independent lifecycle does not earn a table. Its attributes are inlined into `employee` and `candidate`. |
| `User` | `app_user`, `session` | Sessions have their own lifecycle and must be revocable independently of the user (ADR-006). |
| `LeaveBalance` | **`leave_ledger`** | **See §3 — the most significant departure from the analysis model.** |
| `Payslip` | `payslip`, `payslip_line` | A payslip that stores only totals cannot be audited. Line items are their own entity. |
| `AttritionRiskScore` | `attrition_score`, `attrition_contribution` | `signalBreakdown: Map` in the class model becomes a child table — a serialised map cannot be queried, and we need "which signal drives most flags?". |
| `SalaryStructure` | `salary_structure` | Effective-dated rows rather than one mutable row. |
| — | `organisation` | **Not in the analysis model at all.** Multi-tenancy is an architectural concern the class diagram did not capture. |
| — | `audit_log`, `holiday`, `subscription_event`, `feature_gate_hit` | Cross-cutting concerns. |

**The lesson worth recording:** an analysis class model describes the *problem domain*. It
is not a physical schema, and translating it one-to-one would have produced a system that
leaks between tenants and cannot audit its own payroll.

---

## 2. Normalisation — 3NF, and where we knowingly break it

### The rule we applied

Every non-key attribute depends on the key, the whole key, and nothing but the key.

**Worked example — why `payslip_line` exists.** An early draft had:

```
payslip(id, employee_id, period, basic, hra, medical, conveyance, ot, pf, net_pay)
```

This fails 3NF in a way that matters commercially, not just academically:

1. It is **not extensible** — adding a "transport subsidy" allowance requires a schema
   change and a migration on every historical row.
2. It **cannot represent** an allowance an employee does not receive, versus one they
   receive at zero.
3. The component names are **data, not structure** — they vary by tenant, and a
   multi-tenant product cannot put one tenant's allowance names in another tenant's columns.

Decomposing into `payslip_line(payslip_id, code, label, amount, sign)` fixes all three.

### Deliberate denormalisations — two, both justified

| Denormalisation | Why it is safe |
|---|---|
| `payslip.gross`, `.total_deductions`, `.net_pay` derived from `payslip_line` | Payslips are **immutable** (trigger-enforced), so the derived values can never drift. The payroll register would otherwise aggregate millions of line rows on every read. Totals are **asserted against the lines before insert** — a payslip that does not add up is never persisted. |
| `attendance.late_minutes` derivable from `check_in` + department start time | The attrition feature pipeline aggregates it across 60-day windows for every employee nightly. Recomputing per read is wasteful, and the *historical* value must survive a later change to the department's start time. |

Both are on **immutable or append-only** data. That is the only situation where
denormalisation is safe, because neither can produce an update anomaly — neither is ever
updated.

---

## 3. The biggest departure: `LeaveBalance` → `leave_ledger`

Our class model specifies:

```
LeaveBalance
  - entitled: decimal
  - consumed: decimal
  - remaining: decimal
  + deduct(days)
  + restore(days)
```

**This design is not implementable safely, and we changed it.**

`deduct()` and `restore()` mutate a running total. Two managers approving overlapping
requests, or one employee submitting two requests that each fit the balance individually
but not together, corrupt it. We chose PostgreSQL *specifically for ACID* — and a mutable
counter is precisely the shape that ACID cannot protect without explicit locking that the
class model does not describe.

**Replacement:**

```sql
leave_ledger(id, organisation_id, employee_id, leave_type, delta, effective_date,
             reason, source_request_id, created_by, created_at)
-- delta > 0 accrual, delta < 0 consumption, CHECK (delta <> 0)
```

```
balance = SUM(delta) WHERE employee_id = ? AND leave_type = ? AND effective_date <= ?
```

| Property | Mutable balance | Append-only ledger |
|---|---|---|
| Can drift under concurrency | **Yes** | No — arithmetic on immutable rows |
| Answers "why is my balance 7?" | No | **Yes** — every movement has a reason and an actor |
| Cancellation | `restore()` — silently rewrites history | Compensating `+n` row; history preserved |
| Satisfies the proposal's "fully auditable pipeline" objective | By policy | **Structurally** |

The cost is a `SUM` per read instead of a column read, covered by
`idx_ledger_balance(employee_id, leave_type, effective_date)`. At realistic volumes
(a few hundred rows per employee per year) this is not measurable.

**Recommendation to the team:** update the class diagram. `LeaveBalance` becomes
`LeaveLedgerEntry`, with `balanceAsOf(date)` as a derived query rather than a stored field.
It is a better model and it defends itself under questioning.

---

## 4. Multi-tenancy — the control that must not fail

Every business table carries `organisation_id UUID NOT NULL`. Two independent controls:

1. **Repository injection** (primary) — application code never writes
   `WHERE organisation_id = ?` by hand. The tenant comes from the authenticated principal
   and is injected by `Repo`.
2. **PostgreSQL Row-Level Security** (backstop) — for the day someone writes a raw query.

**Why two.** During SQA testing (BUG-11) we found a cross-tenant leak in the *job status*
route — a path that had no repository call at all, so control 1 could not have protected it.
Defence in depth is not paranoia here; it is the documented experience of this project.

**Test:** a cross-tenant read must return zero rows, run in CI on every PR (NFR-14).

---

## 5. Indexing strategy

Indexes are justified by a query, not added speculatively — every index costs write
throughput and storage.

| Index | Query it serves | Why this shape |
|---|---|---|
| `attendance(organisation_id, employee_id, work_date)` | Monthly attendance grid | Covering, in selectivity order. Tenant first (always equality), then employee, then a range scan on date. |
| `leave_ledger(employee_id, leave_type, effective_date)` | `balance = SUM(delta)` | Every balance read; the hottest query in the leave module. |
| `attrition_score(organisation_id, scored_on, score DESC)` | Top-N at-risk dashboard | `score DESC` lets "top 20" be an index scan with no sort. |
| `payslip(organisation_id, period_year, period_month)` | Monthly payroll register | |
| `session(user_id)` | Bulk revocation on termination | Must be fast — it is a security operation, not a report. |
| `idx_payslip_one_per_period` **(partial, unique)** | Duplicate prevention | See §6. |

### Growth projection

| Table | 500 employees, 3 years | 5,000 employees, 3 years |
|---|---|---|
| `attendance` | ~750,000 | ~7,500,000 |
| `payslip_line` | ~144,000 | ~1,440,000 |
| `attrition_score` | ~547,000 | ~5,475,000 |

`attrition_score` grows fastest — one row per employee per night. **Partition by month once
a tenant passes ~2,000 employees.** Flagged now so it is planned, not discovered.

---

## 6. A constraint that did not constrain

Migration 001 declared:

```sql
UNIQUE (employee_id, period_year, period_month, adjusts_payslip_id)
```

intending *"one ordinary payslip per employee per period"*. **It does not do that.** In both
SQLite and PostgreSQL, **NULLs compare as DISTINCT inside a UNIQUE index**, so two ordinary
payslips — each with `adjusts_payslip_id = NULL` — never collide. The constraint read as
though it protected the invariant while protecting nothing.

Found in SQA testing (BUG-12) and fixed in migration 003 with a **partial unique index**:

```sql
CREATE UNIQUE INDEX idx_payslip_one_per_period
  ON payslip (employee_id, period_year, period_month)
  WHERE adjusts_payslip_id IS NULL;
```

This states the rule correctly — uniqueness applies only to *ordinary* payslips — and still
permits several corrections against one original.

**The general lesson, recorded for the team:** a nullable column inside a UNIQUE constraint
almost never means what you intend. When the rule is conditional, express it with a partial
index.

---

## 7. Migrations

Forward-only, numbered, applied in order, tracked in `schema_migration`. No down-migrations:
they are rarely tested, rarely correct, and never used under pressure. A mistake is
corrected by a new forward migration.

| # | Adds |
|---|---|
| 001 | Core schema — 16 tables, immutability triggers |
| 002 | Subscription columns, `subscription_event`, `feature_gate_hit`, `department.office_start_time` |
| 003 | Partial unique index on `payslip` |

---

## 8. Data types

| Concern | Choice | Reason |
|---|---|---|
| Money | `NUMERIC(14,2)` (Postgres) / integer paisa (engine) | **Never float.** `0.1 + 0.2 !== 0.3`; accumulated across payslip lines that becomes the one-taka disputes that destroy trust. |
| Instants | `TIMESTAMPTZ` | Stored UTC; business dates derived in `Asia/Dhaka` by the application, never by the session timezone (ADR-005). |
| Business dates | `DATE` | A date has no timezone once it has been derived. |
| Identifiers | `UUID` | Non-guessable in URLs; no cross-tenant collisions on merge. |
| Enumerations | `TEXT` + `CHECK` | Readable in a dump; a native enum needs a migration to extend. |

---

## 9. Retention

| Data | Retention | Driver |
|---|---|---|
| Payslips, leave ledger | **7 years** | Statutory financial record |
| Attendance | 3 years | Operations + attrition feature windows |
| `attrition_score` | **25 months** | Year-over-year comparison, then delete (spec §9) |
| Feature values | **13 months** | Data minimisation |
| `audit_log` (payroll) | 7 years | Matches the payroll record |
| `audit_log` (access) | 2 years | Security investigation window |
| `session` | 30 days post-expiry | Forensics |

Attrition retention is deliberately the shortest of the personal data. Behavioural scores
are the most sensitive thing the system holds, and keeping them longer than they are useful
creates risk with no benefit.

---

## 10. Open items

1. **PostgreSQL migration** — prototype runs on SQLite (ADR-009). Needs: RLS policies, the
   `EXCLUDE USING gist` overlap constraint, `NUMERIC` money, `TIMESTAMPTZ`.
2. **Partitioning** `attrition_score` by month at scale.
3. **Read replica** for reporting once payroll and dashboards contend.
4. **Column-level encryption** for `nid_hash` and bank details via KMS.
