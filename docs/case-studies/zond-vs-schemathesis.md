# zond vs Schemathesis on the same live API — an honest head-to-head

> **Same 112 Stripe endpoints, same live test-mode key, same afternoon.** Both
> tools independently agreed on the one thing that matters — **zero server
> errors (5xx)** — and both drowned in the exact same noise class (Stripe's
> semantic validation is stricter than any spec-shape generator). The real
> difference is not detection power. It's that Schemathesis dumped **201 flat
> "failures"** where ~198 are two noise/ordering classes, while zond calibrated
> the same signal down to **0 real HIGH + a short contract-hygiene list**. Each
> tool has capabilities the other lacks entirely — neither is a superset.

This is the parity check the strategy has always insisted on: *Schemathesis is
measured, not chased.* Here is the measurement, both gaps pointed honestly.

## The setup (fixed for both)

| | |
|---|---|
| Target | Stripe API, official spec (`2026-04-22.dahlia`, 587 ops, ~10 MB dereferenced) |
| Scope | identical `--include` regex: `charges, customers, invoices, payment_intents, payouts, quotes, refunds` → **112/587 operations** |
| Auth | same live **test-mode** secret key (`sk_test_…`), Bearer header |
| Sandbox | user's own Stripe test-mode account — fake money, no pre-existing resources deleted |
| zond | 0.27.1, agent-driven `/zond-scan` convention (run #3, 2026-07-10) |
| Schemathesis | 4.16.1, `--checks all --max-examples 4 -w 3 --rate-limit 20/s` |

Schemathesis: **635 test cases, 280 s wall-clock, 112/112 ops touched.**
zond run #3: **1,969 depth-check cases + probes, 112/112 ops touched.**

## Where they agree (the load-bearing result)

**Zero `not_a_server_error` failures in either tool.** No 5xx anywhere across
635 Schemathesis cases or 1,969 zond cases. This is the single most important
line in both reports, and it's the same line — independent cross-validation
that Stripe's money core is solid under garbage input, from two engines that
share no code.

**Both are dominated by the same noise class.** Schemathesis's
`positive_data_acceptance` fired **103 times** ("API rejected schema-compliant
request"); zond's identical check fired **363–401 times**. Same root cause,
verbatim: a schema-typed body (`invoice_prefix: ""`, random string for
`customer`, boundary-length `description`) is *shape-valid* but
*semantically* rejected by Stripe with a specific business-rule 400
(`"No such customer…"`, `"empty values are an attempt to unset a parameter"`).
Neither tool is wrong; **Stripe's real validation is simply stricter than any
generic spec-shape generator can satisfy.** Both tools produce this, and both
must calibrate it away — it is not drift and not a bug.

## Schemathesis's fuzzer found two things zond's run didn't

Both are checks zond *has*; the difference is Schemathesis's Hypothesis engine
generated inputs that tripped them and zond's seed-body-driven run didn't.

- **`content_type_conformance` ×3 — a genuine mild hygiene finding.** By fuzzing
  path params to megabyte lengths, Schemathesis provoked **`414 URI Too Long`**
  and some **`404`** responses that Stripe's edge/WAF returns as
  `text/html` / `text/plain; charset=utf-8` instead of the documented
  `application/json`. zond has `content_type_conformance` too, but its
  deterministic bodies never triggered a 414, so it never saw this. Real,
  low-severity, contract-hygiene drift — **found by fuzzing, not by checks.**

- **`missing_required_header` ×95 — mostly a 404-before-401 ordering artifact.**
  On no-auth requests to nested `/{id}/…` sub-resource paths with synthetic
  ids, Stripe returns **404 (69×)** or **400 (26×)** instead of the expected
  **401** — path resolution fails before auth is evaluated. zond has this axis
  too (`ignored_auth`), and its run produced **444 intentional 401s** proving
  auth *is* enforced on the base endpoints. So this cluster is exactly the kind
  of raw finding zond's severity calibration collapses to a one-liner —
  Schemathesis reports all 95 flat.

That is the honest asymmetry in Schemathesis's favor: **a real property-based
fuzzing engine with auto-shrinking and minimal-curl reproducers surfaces
edge-response drift a deterministic checker won't reach.** zond does not have
this engine, by design (ARV-182 fuzz-engine is deferred).

## What zond has that Schemathesis lacks entirely

The 12-check conformance axis that m-18 measured is now **12/12 present by
catalog name in zond** — the gap that once existed on that axis has closed.
zond additionally ships **7 checks Schemathesis has no equivalent for**:

| zond check | what it asserts | Schemathesis |
|---|---|---|
| `idempotency_replay` | two POSTs w/ same `Idempotency-Key` → identical id + bit-identical body | — |
| `lifecycle_transitions` | declared state machine moves without regression (`draft→finalize→pay`) | — |
| `cross_call_references` | fields POST accepts/echoes must be readable via GET | — |
| `pagination_invariants` | consecutive cursor pages disjoint; `has_more` agrees with items | — |
| `cursor_boundary_fuzzing` | malformed cursor → 4xx never 5xx | — |
| `open_cors_on_sensitive` | authed endpoint must not echo arbitrary Origin + `Allow-Credentials: true` | — |
| `rate_limit_headers_absent` | mutating endpoints should advertise rate-limit semantics | — |

Plus the two things this whole comparison is really about:

- **Severity calibration / no-evidence-no-high.** Schemathesis emits 201
  "failures" with no severity and no rollup; a user reads a wall and has to
  triage from scratch. zond's run took the *same* raw signal (~965 raw
  findings) and calibrated it to **0 real HIGH, with narrative rollups**
  ("Stripe's validation is stricter than the generator," "CORS combo is
  spec-illegal but inert under Bearer auth," "these two fixtures went stale
  mid-run"). On a mature commercial API, calibration *is* the product.

- **Agent-first `dump → reason → apply` + fixture seeding.** zond's hand-authored
  `seed_body` overlay got **6/7 money endpoints to honest-2xx live**.
  Schemathesis's own generator **failed its health check on 8 ops** because it
  could not author a Stripe-valid form-encoded body from the schema alone —
  the same wall zond's seeding step is built to climb.

## The honest asterisks

- **This is one API, and a heavily-validated one.** On a sloppier backend the
  fuzzer's edge would show more; on this one it surfaced 3 real
  content-type-drift responses and a 95-wide ordering artifact. Don't read
  "zond calibrated 201→0" as "zond is stricter" — read it as "the raw signal
  was nearly all noise, and one tool said so."
- **Neither tool is a superset.** Schemathesis has the fuzzing engine +
  shrinking + stateful link-inference (attempted here, errored on Stripe's
  spec); zond has 7 stateful/hygiene invariants + calibration + seeding.
  Picking one means picking which gap you can live with.
- **Schemathesis choked on 13 ops** (`Schema Error`) it couldn't compile from
  Stripe's spec; zond touched all 112. Conversely zond does not shrink failing
  cases to a minimal reproducer — Schemathesis emits a ready `curl` for every
  finding.
- Counts here are raw where labelled raw. zond's headline number is the
  *calibrated* one (0 real HIGH); Schemathesis reports only raw.

## Numbers (identical scope, live test-mode)

| | zond run #3 | Schemathesis 4.16.1 |
|---|---|---|
| operations tested | 112/112 | 112/112 |
| test cases | 1,969 depth + probes | 635 generated |
| wall-clock | multi-phase agent run | 280 s |
| server errors (5xx) | **0** | **0** |
| raw findings | ~965 | 201 unique failures + 21 errors |
| real HIGH after calibration | **0** | (no calibration layer) |
| conformance checks | 19 (incl. all 12 of Schemathesis's) | 12 |
| property-based fuzzing engine | no (deferred) | **yes** (Hypothesis + shrinking) |

**Bottom line:** on a real, well-validated commercial API the two tools find
nearly the same raw signal and agree on the only hard result (no 5xx). What
differs is the fuzzing *reach* (Schemathesis wins on edge-response drift) and
the *presentation* (zond wins on severity calibration, hygiene/stateful
invariants, and getting to honest-2xx via seeding). Measure Schemathesis; don't
chase it — and don't pretend zond replaces it.

---
*API hygiene scanner for small teams and their coding agents — test REST API endpoints against the OpenAPI spec, catch contract drift, track coverage.* — [github.com/kirrosh/zond](https://github.com/kirrosh/zond)
