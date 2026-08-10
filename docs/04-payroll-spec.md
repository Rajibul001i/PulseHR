# Payroll & Leave Engine — Specification

**Resolves:** P0-8, P0-9, P1-1, P1-2, P1-3
**Implemented in:** `packages/core/src/payroll.ts`, `packages/core/src/leave.ts`

> ⚠️ **Verify before submission.** Every statutory figure below must be checked against the
> current consolidated text of the Bangladesh Labour Act 2006 (as amended, including the
> 2013 and 2018 amendments) and cited by section number in the proposal. The engine is built
> so these values are **configuration, not code** — correcting a figure is a config change,
> not a code change. That design decision is the durable part; the numbers are inputs.

---

## 1. What the source documents got wrong

| Claim | Problem |
|---|---|
| *"statutory earned leaves (21 days per year for eligible employees)"* | §117 grants **1 day per 18 days worked** — an accrual, ≈20 days over a full year and proportionally less for a mid-year joiner. A flat 21 is wrong, and any flat number is wrong. |
| *"overtime pay rates (at twice the standard hourly rate)"* | §108 sets OT at twice the ordinary rate of **basic** wage. "Standard hourly rate" reads as gross ÷ hours, which **overpays every OT hour on every payslip**. |
| *"NBR income tax slabs … calculated accurately"* | Slabs change with every Finance Act. Never specified, and the investment rebate is not mentioned — a TDS calculation without it over-deducts. |
| Casual, festival and maternity leave | **Absent from both documents entirely.** |
| `PAYROLL_LOG(… net_pay …)` | A single net figure cannot be audited or disputed. Contradicts the proposal's own "fully auditable pipeline" promise. |

---

## 2. Leave entitlements

Configuration, per tenant, effective-dated. Defaults below reflect the Act for adult workers
in shops and commercial establishments.

| Type | Act ref | Default | Accrual | Carry-forward | Paid |
|---|---|---|---|---|---|
| **Earned / Annual** | §117 | 1 day per **18 days worked** | Continuous, on days actually worked | Up to **40 days** | Yes |
| **Casual** | §115 | **10 days/year** | Granted at year start, pro-rated for joiners | **None** — lapses | Yes |
| **Sick** | §116 | **14 days/year** | Granted at year start | None | Yes, full wages |
| **Festival** | §118 | **11 days/year** | Fixed calendar | N/A | Yes |
| **Maternity** | §46 | **16 weeks** (8 before + 8 after) | On qualification | N/A | Yes, conditions apply |
| **LWP** | — | Unlimited | N/A | N/A | **No** — drives proration |

### Earned-leave accrual — the key correction

```
accrued_days = floor( days_actually_worked / 18 )
```

Not `21`. Not `20`. **Derived from attendance.** A person who joined in October has worked
~60 days by year end and has accrued ~3 days, not 21.

Days actually worked **excludes** LWP and unauthorised absence, and **includes** paid leave
and festival holidays (they count as service).

### Balance is a ledger, never a column

**Resolves P0-7.**

```
balance(employee, leave_type, as_of)
  = SUM(delta) FROM leave_ledger
    WHERE employee_id = ? AND leave_type = ? AND effective_date <= ?
```

Append-only. Accrual writes `+n`; an approved request writes `−n`; a cancellation writes a
compensating `+n` — never a delete. Consequences: the balance cannot drift, every change has
a reason and an actor, and the proposal's own "fully auditable pipeline" objective is
satisfied structurally rather than by policy.

### Concurrency

Approval runs inside a transaction that:

1. takes `SELECT … FOR UPDATE` on the employee's ledger rows for that leave type,
2. re-computes the balance **inside** the lock,
3. checks for **overlapping approved requests**,
4. writes the consumption row and flips the status, or aborts.

PostgreSQL additionally enforces overlap at the schema level:

```sql
ALTER TABLE leave_request ADD CONSTRAINT no_overlapping_leave
  EXCLUDE USING gist (
    employee_id WITH =,
    daterange(start_date, end_date, '[]') WITH &&
  ) WHERE (status = 'APPROVED');
```

The prototype (SQLite, ADR-009) enforces steps 1–4 in the transaction; the exclusion
constraint is PostgreSQL-only and is the production backstop.

---

## 3. Salary structure

Effective-dated, never overwritten — payroll for March 2026 must reproduce identically in
2029, which means it needs the salary **as it was**, not as it is.

| Component | Type | In OT base? | In gratuity base? |
|---|---|---|---|
| Basic | Fixed | **Yes** | Yes |
| House rent | % of basic (typ. 50%) | No | No |
| Medical | Fixed | No | No |
| Conveyance | Fixed | No | No |
| Food | Fixed | No | No |
| Dearness / ad-hoc | Fixed | **Yes** | Yes |

```
gross = basic + house_rent + medical + conveyance + food + dearness
```

---

## 4. Overtime

**Resolves P1-2.** The base is explicit, and it is not gross:

```
ot_base_monthly  = basic + dearness              ← NOT gross
ot_hourly        = ot_base_monthly / standard_monthly_hours
ot_pay           = ot_hourly × 2.0 × ot_hours
```

`standard_monthly_hours` defaults to **208** (8 h/day × 26 days), configurable per tenant.

Statutory limits enforced by the engine, which **rejects** a run that breaches them rather
than silently paying:

| Limit | Act ref | Value |
|---|---|---|
| Ordinary daily hours | §100 | 8 |
| Ordinary weekly hours | §102 | 48 |
| Max weekly hours incl. OT | §102 | 60 |
| Max annual average weekly | §102 | 56 |

### Worked example

Basic 30,000; dearness 0; gross 50,000; 10 OT hours.

```
ot_hourly = 30,000 / 208            = 144.23
ot_pay    = 144.23 × 2 × 10         = 2,884.62   ✅ correct
```

The wrong reading — twice the *gross* hourly rate:

```
ot_hourly = 50,000 / 208            = 240.38
ot_pay    = 240.38 × 2 × 10         = 4,807.69   ❌ overpays by 1,923.08
```

**A 67% overpayment on every overtime hour.** Across 200 employees averaging 8 OT hours a
month, that is roughly **BDT 3.7 lakh per year** paid out in error — from one ambiguous
sentence in the proposal. This is the single most expensive defect in the document set.

---

## 5. Leave Without Pay proration

```
payable_days   = days_in_period − lwp_days
proration      = payable_days / days_in_period
prorated_gross = round2(gross × proration)
```

`days_in_period` is **calendar days in the month** (28–31), not a fixed 30, and not working
days. Using a fixed 30 makes February systematically overpay and 31-day months underpay.

Proration applies to **every earning component**, not to basic alone.

---

## 6. Deductions

| Deduction | Basis | MVP scope |
|---|---|---|
| LWP | Proration above | ✅ In |
| Provident fund | % of basic, employee side | ✅ In (configurable, default 0) |
| Advance / loan recovery | Fixed instalment | ✅ In |
| **Income tax (TDS)** | NBR slabs, §86 | ❌ **Out of MVP — see below** |

### On income tax — say what you actually built

**Resolves P1-3.** The proposal claims NBR slab compliance. Correct handling:

- Slabs are **effective-dated reference data** in `tax_slab`, keyed by fiscal year, loaded
  from a table. Never compiled into the engine — they change with every Finance Act.
- A correct TDS calculation additionally requires the **investment rebate**, which depends on
  each employee's declared investments. Without it, every investing employee is
  over-deducted.
- Because that declaration workflow is a module in its own right, **TDS is out of scope for
  the 8-week MVP.** The schema and the slab table are in place; the calculation is deferred.

State this in the proposal. Claiming compliance you have not built is worse than scoping it
out deliberately — and scoping it out with a documented reason reads as engineering
judgement.

---

## 7. Payslip: immutable and line-itemised

**Resolves P0-8.**

The source ERD's `PAYROLL_LOG(payroll_id, employee_id, period, net_pay, generated_at)` cannot
be audited. When an employee says *"my salary is short"*, a single net figure gives you
nothing to show them.

Every payslip stores:

| Field | Why |
|---|---|
| `salary_structure_id` | The exact version in force — makes the run reproducible |
| `engine_version` | Which code produced it — makes a rule change traceable |
| `days_in_period`, `lwp_days`, `payable_days` | The proration inputs |
| `ot_hours`, `ot_rate_applied` | The OT inputs |
| `payslip_line[]` | Every earning and deduction as its own row, with code, label, amount, sign |
| `gross`, `total_deductions`, `net_pay` | Derived, stored for query speed, asserted against the lines |
| `issued_at`, `issued_by` | Who ran it |

**Immutable after issue.** A correction is a **new adjustment payslip** referencing the
original, never an UPDATE. Enforced by a database trigger (NFR-9) and by a test.

```
gross            = Σ lines WHERE sign = +1
total_deductions = Σ lines WHERE sign = −1
net_pay          = gross − total_deductions      ← asserted at write time
```

If that assertion fails, the run aborts. A payslip that does not add up is never persisted.

---

## 8. Rounding

One rule, applied consistently — mixed rounding is a classic source of one-taka disputes
that erode trust in the whole system:

- Every monetary value: **2 decimal places, half-up**.
- Round at **each line item**, then sum. Never sum unrounded values and round the total —
  the two differ, and only the first matches what the employee sees on the payslip.
- Money is stored as `NUMERIC(14,2)` in PostgreSQL and as **integer paisa** in the core
  engine. Floating-point money is not used anywhere.

---

## 9. Business dates

**Resolves P0-9.** Every date in this engine — period boundaries, LWP day counts, accrual
windows — is a **business date in `Asia/Dhaka`**, derived through the single `businessDate()`
helper (ADR-005).

The working week defaults to a **Friday + Saturday** weekend, configurable per tenant. An
engine defaulting to Saturday–Sunday miscounts working days in every Bangladeshi payroll run.

---

## 10. Test boundaries

The proposal promises white-box testing of "boundary cases". Here is the actual list,
implemented in `packages/core/test/payroll.test.ts`:

| # | Case | Expectation |
|---|---|---|
| 1 | Zero leave balance, leave requested | Rejected, balance unchanged |
| 2 | Full-month LWP | Net = 0, payslip still issued |
| 3 | LWP **and** OT in the same month | Both applied; proration does **not** touch OT pay |
| 4 | February (28 days) | Proration divides by 28, not 30 |
| 5 | Joiner mid-month | Prorated from hire date |
| 6 | Leaver mid-month | Prorated to last working day |
| 7 | OT above the 60 h weekly ceiling | Run **rejected** with a named error |
| 8 | Accrual at exactly 18 days worked | Exactly 1 day accrued |
| 9 | Accrual at 17 days worked | **0** days accrued (floor, not round) |
| 10 | Two overlapping leave requests, submitted concurrently | Second rejected; balance never negative |
| 11 | Payslip lines vs stored totals | Assertion holds; mismatch aborts |
| 12 | 23:30 Dhaka check-in | Business date is **the same day**, not the next |
| 13 | Rounding: 3 lines at x.005 | Each rounded then summed — matches printed payslip |
| 14 | Salary revision mid-month | Uses the structure in force on the **period start** |
