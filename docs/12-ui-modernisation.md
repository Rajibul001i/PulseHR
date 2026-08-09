# UI/UX — What's Modern, and What Actually Matters for Subscription Software

**Status:** recommendation. Implementation is the next work item.
**Why now:** the current dashboard is a competent 2015 admin panel. It is not wrong; it is
dated, and — more importantly — **it has no idea it is part of a subscription product.**

---

## 1. The honest assessment of what we have

| What we built | Verdict |
|---|---|
| Fixed 232px dark sidebar, always visible | Dated. Breaks entirely below 900px. |
| Data straight into `<table>` | Fine for density, but no sorting, filtering, pagination or column control |
| No loading states | Every page flashes empty, then fills |
| No empty states | A new tenant with zero employees sees a blank table and no idea what to do |
| Errors as red text at the top | Easy to miss; disappears on navigation |
| No feedback on success | Approve a leave request and nothing visibly happens |
| Dark theme only | Not a choice — a limitation |
| **No concept of a plan, a trial, seats, or upgrading** | **This is the real problem** |

That last row is the one that matters. Everything above is polish. A subscription product
whose interface never mentions the subscription is missing its commercial spine.

---

## 2. What "modern" actually means in 2026 B2B SaaS

Ignore visual fashion. These are the patterns that recur across Linear, Stripe, Vercel,
Notion and every serious B2B product, because each solves a real problem.

### 2.1 The product knows what you're paying for — **highest value for us**

Modern SaaS surfaces the plan continuously and without shame:

- **Plan badge in the sidebar** — "Growth · 120/300 seats", always visible.
- **Locked features stay visible, greyed, with a lock icon.** They are *not* hidden.
  Hiding a feature means the customer never learns it exists and never upgrades. Showing it
  is the single highest-leverage pattern in subscription UI.
- **Upgrade prompts describe the value, not the restriction.** "Full attrition intelligence
  scores every employee nightly" beats "Your plan does not include this."
- **Seat pressure surfaced early.** At 90% of the seat limit, a quiet banner. Discovering
  you are over the limit when HR cannot onboard a new joiner is the worst possible moment.
- **Trial countdown** that gets more prominent as it shortens, never a modal that blocks work.

Our API already returns all of this from `GET /api/subscription` — entitlements, seats,
tier, price, and the full feature catalogue. The UI simply does not use it yet.

### 2.2 Command palette (⌘K)

For an HR admin who does the same six things all day, a palette beats navigation. Type
"Farhana" → jump to her profile. Type "payroll" → run it. This is now an expectation in
professional tools, and it is roughly 150 lines of code.

### 2.3 Optimistic UI with toasts

Approve a leave request: the row updates *immediately*, a toast confirms, and it rolls back
with an error toast if the server refuses. Our leave approval can genuinely fail (409 on
insufficient balance — by design), so the rollback path is real, not theoretical.

### 2.4 Skeletons, not spinners

A skeleton in the shape of the content that is coming makes the page feel roughly twice as
fast as a spinner, because the layout does not jump.

### 2.5 Empty states that teach

A blank table is a dead end. "No employees yet — import a CSV or add your first employee"
with the button right there converts a confused new tenant into an active one. For a
subscription product, **the empty state is the onboarding**.

### 2.6 Real data tables

Sort, filter, paginate, choose columns, save a view, export CSV. HR staff live in these
tables all day. Ours currently do none of it.

### 2.7 Responsive, and a real mobile view

An employee checking in, requesting leave, or reading a payslip is on a phone. In
Bangladesh, overwhelmingly so. Our current layout is unusable below 900px. The employee
surface must be mobile-first; the HR admin surface can stay desktop-first.

### 2.8 Light and dark, following the system

Dark-only reads as a hobby project. HR staff in a bright office want light mode.

### 2.9 Accessible by construction

Keyboard navigation, focus rings, `aria-live` for toasts, 4.5:1 contrast. Enterprise
procurement increasingly asks for WCAG 2.1 AA — this is a **sales** requirement, not only an
ethical one. It is already NFR-11 and currently unmet.

### 2.10 Bangla language support

The single most useful localisation decision available to us. Payslips in Bangla especially.
Our NFR-13 defers this — worth revisiting, because for the actual market it is a
differentiator, not a nicety.

---

## 3. What to ignore

Not everything fashionable is useful:

- **Glassmorphism / heavy blur** — hurts contrast, hurts accessibility, ages fast.
- **Full-screen animated onboarding tours** — users skip them.
- **AI chat bolted onto everything** — we have a genuine AI feature; a chatbot would dilute it.
- **Aggressive upgrade modals that block work** — the fastest way to make a paying customer
  resent the product.
- **Infinite scroll in HR tables** — pagination is correct where people need "page 3 again".

---

## 4. Recommended plan

### Phase 1 — Subscription-aware shell *(the commercial gap)*
1. `GET /api/subscription` consumed at sign-in, stored in Redux.
2. Plan badge + seat meter in the sidebar.
3. Locked nav items shown greyed with a lock, routing to an upgrade page.
4. Upgrade page rendering the entitlement catalogue with per-tier pitches.
5. 402 responses render an upgrade prompt, not a generic error.
6. Seat warning banner at 90%.

### Phase 2 — Interaction quality
7. Toast system replacing inline error text.
8. Skeleton loaders on every async view.
9. Empty states with a primary action on every list.
10. Optimistic leave approve/reject with rollback.

### Phase 3 — Layout & platform
11. Responsive shell: collapsible sidebar, bottom nav on mobile.
12. Light/dark following `prefers-color-scheme`, with a manual override.
13. Command palette (⌘K).
14. Data table with sort, filter, pagination and CSV export.

### Phase 4 — Polish
15. WCAG 2.1 AA pass with axe-core in CI (closes NFR-11).
16. Bangla localisation groundwork.

**Phase 1 is the one that matters commercially** and is where I would start. Phases 2–3 are
what make it feel modern. Phase 4 is what makes it sellable to an enterprise buyer.

---

## 5. Why Phase 1 first, concretely

Every other item on this list makes the product *nicer*. Phase 1 makes it a *product*.

Right now a Growth customer and an Enterprise customer see an identical interface. There is
no visible reason to upgrade, no visible evidence of what they are paying for, and no
prompt at the moment they hit a limit. The API can now answer all three questions — the
interface just has to ask.

That is also the honest answer to "what is modern and more useful for subscription
software": not the visual style, but **the product being aware of the commercial
relationship it is in.**
