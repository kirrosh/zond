# Walking Stripe's money lifecycle live with a coding agent

> **A coding agent drove zond through Stripe's full invoice and quote lifecycle on a live test-mode account — `draft → finalize → pay` and `draft → finalize → void`, 15/15 green — and the one thing that nearly hid the entire state machine wasn't a Stripe bug. It was that a generic scanner defaults request bodies to `currency: usd`, the account is denominated in EUR, and that one mismatch silently zeros the invoice so it finalizes straight to `paid`.** Zero backend bugs, zero security findings. The story is what it takes to test a real lifecycle honestly.

## What we did

- Target: Stripe REST API, official spec ([`stripe/openapi`](https://github.com/stripe/openapi), OpenAPI 3.x, 587 operations, `stripe-version: 2026-04-22.dahlia`).
- Tool: zond 0.27.1, driven by a coding agent, live against a **test-mode** account (`sk_test_…`, fake money).
- Mode: **live**, deliberately narrowed to the money-lifecycle slice — invoices, invoice items, quotes — rather than a breadth pass across all 587 endpoints.
- Deliverable: a hand-authored lifecycle scenario (`invoice-lifecycle.yaml`) that walks a resource from creation through its terminal states, now a permanent post-deploy smoke test.

## What we found

**No backend bugs — and that's the honest headline.** Every money-moving create in scope succeeds live with a correctly-authored form-encoded body. The interesting part is what it took to *reach* the lifecycle, and what that reveals about testing an API you don't own.

The textbook lifecycle — create a `customer`, add a customer-scoped invoice item, create an invoice, finalize it to `open`, then pay or void — **does not hold** on this API version, for two reasons the agent discovered by reading the API's own 4xx responses:

1. **Pending invoice items are no longer auto-included.** A customer-only invoice item doesn't attach to the next invoice in `dahlia`; the item needs an explicit `invoice=` *and* `customer=`. Miss that and the invoice is empty.

2. **`currency: usd` on a EUR account silently zeros the invoice.** This is the one worth the whole run. The account's default currency is EUR. A generic generator fills money bodies with `usd`. Stripe rejects the invoice item with a currency-conflict 400 — but the invoice was already created, so it stays at `amount_due = 0`, and a $0 invoice **finalizes straight to `paid`**. The `open → pay` and `open → void` transitions become unreachable, and a fuzzer would report a perfectly green `finalize → paid` and move on — having tested none of the state machine.

Once the agent seeded the account's real currency and ordered the creates correctly, the full lifecycle ran green: `draft → finalize(open) → pay(out-of-band) → paid` with a readback confirming the terminal state, and a second invoice `draft → finalize(open) → void`.

**Zero of the scary stuff:** no 5xx anywhere, no auth bypass, no mass-assignment (probes came back INCONCLUSIVE on an empty account — reported as "couldn't test", not "clean"). Honest reporting means saying that plainly.

## The honest asterisks (why this is a *hygiene* tool, not a bug-bounty flex)

- **This was a targeted slice, not breadth.** 12 endpoints exercised with a live 2xx, all in the money-lifecycle. We are not claiming coverage of Stripe's 587 operations — we're claiming the invoice/quote state machine works end-to-end and here's exactly what it took.
- **The drift we found is not a Stripe bug — it's a scanner-default bug.** The `usd`-on-a-EUR-account trap is a defect in how a generic tool seeds bodies, not in Stripe. We filed it against zond (currency-aware fixtures), not Stripe. Overclaiming a "Stripe lifecycle bug" would be exactly the dishonesty our positioning forbids.
- **`payouts` stayed untested, and we say so.** Exercising payouts needs a test bank account attached to the account — an external-input step no plain API call self-serves. We documented the gap rather than faking around it.
- **The agent did the judgment; the tool did the driving.** zond issued the requests, stored every run, and asserted the state transitions. Reading three consecutive 400s and inferring "the account is EUR, not USD" was the agent's work — which is the whole model: a deterministic tool plus an agent that reasons about what it returns.

## Why it matters for a small team

You will point a scanner at an API whose account settings you didn't choose — a client's Stripe, a EUR-denominated tenant, a staging environment seeded by someone else. A tool that defaults to `usd` and reports green when the invoice silently zeroes out is worse than no tool: it tells you the lifecycle passed when it never ran. The value here is an agent that noticed the invoice was empty, traced it to a currency mismatch, fixed the seed, and drove the real state machine — and left behind a scenario file that re-runs that exact flow on every deploy.

## Numbers (Stripe lifecycle deep-dive, live)

| | |
|---|---|
| spec operations | 587 |
| scope | money-lifecycle slice (invoices, invoice items, quotes) |
| lifecycle scenario | 15/15 steps green, live |
| lifecycle-gated endpoints newly exercised live | 6 (finalize, pay, void, quote-finalize, invoice-attached item, paid-state readback) |
| backend bugs (5xx / schema violations) | 0 |
| security findings | 0 (mass-assignment INCONCLUSIVE on empty account) |
| tool-defect findings filed (against zond, not Stripe) | 5 (currency-aware fixtures + 4 DX/reporting gaps) |
| destructive requests to real-money endpoints | 0 (test mode, fake money; created resources cleaned up) |

---

*API hygiene scanner for small teams and their coding agents — test REST API endpoints against the OpenAPI spec, catch contract drift, track coverage.* — [github.com/kirrosh/zond](https://github.com/kirrosh/zond)
