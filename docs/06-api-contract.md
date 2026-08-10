# API Contract & Screen Inventory

**Resolves:** P2-6 (the "15 main screens" that were never enumerated)
**Implemented in:** `apps/api/src/server.ts`

Base URL `/api`. All responses JSON. All endpoints except `/auth/*` require
`Authorization: Bearer <access token>`.

---

## 1. Conventions

| Status | Meaning |
|---|---|
| `200` | OK |
| `201` | Created |
| `202` | **Accepted — queued as a job** (ADR-004). Poll `/jobs/{id}`. |
| `400` | Validation failed |
| `401` | Missing, expired or revoked token |
| `403` | Authenticated but not permitted for this role |
| `404` | Not found **or not in your tenant** — the two are deliberately indistinguishable |
| `409` | Business-rule conflict (insufficient balance, overlapping leave) |
| `429` | Rate limited |

> **On 404 vs 403 for cross-tenant reads:** returning 403 would confirm the resource exists
> in some other tenant. 404 leaks nothing.

## 2. Authentication

| Method | Path | Role | Notes |
|---|---|---|---|
| POST | `/auth/login` | — | → `accessToken` (15 min), `refreshToken` (7 d). Rate limited 5/15 min. |
| POST | `/auth/refresh` | — | Single-use, rotated on every use |
| POST | `/auth/logout` | any | **Revokes every session for the user** (ADR-006) |

## 3. Employees

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/me` | any | Principal, employee record, leave balances |
| GET | `/employees` | any | Tenant-scoped |
| GET | `/employees/{id}` | any | Includes derived balances |

## 4. Attendance

| Method | Path | Role | Notes |
|---|---|---|---|
| POST | `/attendance/check-in` | any | Business date derived in **Asia/Dhaka** (ADR-005) |
| POST | `/attendance/check-out` | any | Computes hours worked and OT |
| GET | `/attendance/mine?from&to` | any | Own records only |
| GET | `/attendance/grid?from&to` | MANAGER, HR | The monthly grid — hot path |

## 5. Leave

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/leave/requests` | any | EMPLOYEE sees only their own |
| GET | `/leave/balances?employeeId` | any | Derived from the ledger; EMPLOYEE restricted to self |
| POST | `/leave/requests` | any | → `201 {id, days}` |
| POST | `/leave/requests/{id}/decision` | MANAGER, HR | **The transactional approval.** `409` on insufficient balance or overlap. |

```jsonc
// POST /leave/requests/{id}/decision   { "decision": "APPROVE" }
// 200 → { "status": "APPROVED", "balanceAfter": 2 }
// 409 → { "error": "Requested 5 day(s) against a balance of 2",
//         "code": "INSUFFICIENT_BALANCE", "balance": 2 }
```

## 6. Payroll

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/payroll/payslips?employeeId` | any | EMPLOYEE restricted to self |
| GET | `/payroll/payslips/{id}` | any | Payslip **plus its line items** |
| GET | `/payroll/preview?employeeId&year&month` | HR | Structure in force, without issuing |
| POST | `/payroll/runs` | HR | **`202`** + `jobId` — never runs in the request path |
| GET | `/jobs/{id}` | any | `QUEUED` / `RUNNING` / `DONE` / `FAILED` |

## 7. Attrition — HR only

Access control here is a **hard requirement**, not a display preference. See
[`05-attrition-risk-spec.md`](05-attrition-risk-spec.md) §9.

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/attrition/at-risk?limit` | **HR_ADMIN only** | Every read written to `audit_log` |
| GET | `/attrition/scores/{id}` | **HR_ADMIN only** | Score **+ contributions + prohibited-use notice**, together or not at all |
| POST | `/attrition/runs` | HR_ADMIN | `202` + `jobId` |

A MANAGER receives `403`. This is deliberate: a line manager who can see that a report is
flagged as a flight risk produces retaliation and self-fulfilling-prophecy harms.

## 8. Noticeboard

| Method | Path | Role |
|---|---|---|
| GET | `/notices` | any |
| POST | `/notices` | HR_ADMIN |

---

## 9. Screen inventory — the 15 screens

The proposal promises *"UI/UX wireframes for all 15 main screens"* but never lists them,
so the deliverable cannot be checked off. Here they are.

| # | Screen | Module | Roles | Increment | Prototype |
|---|---|---|---|---|---|
| 1 | Login | Auth | all | 1 | ✅ |
| 2 | HR dashboard — at-risk list, headcount | Core | HR | 2/4 | ✅ |
| 3 | Employee self-service dashboard | Core | EMPLOYEE | 2 | ✅ |
| 4 | Employee directory | Core | MANAGER, HR | 2 | ✅ (API) |
| 5 | Employee profile detail | Core | MANAGER, HR | 2 | ✅ (API) |
| 6 | Attendance monthly grid | Attendance | MANAGER, HR | 2 | ✅ |
| 7 | My attendance + check in/out | Attendance | all | 2 | ✅ |
| 8 | Leave request form + my requests | Leave | all | 2 | ✅ |
| 9 | Leave approval queue | Leave | MANAGER, HR | 2 | ✅ |
| 10 | Payslip list | Payroll | all | 3 | ✅ |
| 11 | Payslip detail (printable) | Payroll | all | 3 | ✅ |
| 12 | Payroll run console | Payroll | HR | 3 | ✅ |
| 13 | Attrition score breakdown | AI | HR | 4 | ✅ |
| 14 | Noticeboard | Comms | all | 4 | ✅ |
| 15 | OKR goals & review | Performance | all | 3 | ⬜ specified, not built |
| 16 | ATS Kanban pipeline | Recruitment | HR | 3 | ⬜ specified, not built |

> Sixteen, not fifteen — the count in the proposal was approximate. Use the real list, and
> mark 15 and 16 as the two screens the prototype specifies but does not implement. Being
> precise about what is *not* built is more credible than a round number.
