---
id: ARV-420
title: >-
  open_cors_on_sensitive fires HIGH x111 on Stripe's wildcard-CORS+credentials
  header combo despite bearer-token (non-cookie) auth
status: Done
assignee: []
created_date: '2026-07-10 12:39'
updated_date: '2026-07-10 13:13'
labels:
  - m-28
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Stripe run#3 (m-28), scoped depth pass (112 in-scope ops). 'checks run' (default check set) fired open_cors_on_sensitive on 111/112 operations — effectively every op in scope — because Stripe's API responses carry both 'access-control-allow-origin: *' and 'access-control-allow-credentials: true' (verified directly: GET /v1/account headers). The check's own doc comment (src/core/checks/checks/open_cors_on_sensitive.ts) frames the danger as 'any cross-origin site can read authenticated responses on behalf of a logged-in user' — that threat model assumes cookie/ambient-credential auth. Stripe (and any bearer-token/apiKey-header API — the securityScheme here is 'bearerAuth: http/bearer') doesn't authenticate via cookies, so a foreign origin reading this header combo can't silently attach a victim's credential the way it could with session cookies; the header combo is spec-illegal and wasteful but not the CSRF-with-data-exfil scenario the check is built to catch. Two related, deterministic (not severity-judgment) fix candidates: (1) scope narrowing — when the operation's *only* security scheme(s) are bearer/apiKey-in-header (no cookie-based / apiKey-in-cookie scheme declared anywhere in the spec), this is knowable from the spec alone and the check could note reduced exploitability in its evidence/message (agent still decides final severity, per litmus test — this is just carrying the auth-scheme fact through, not suppressing the finding); (2) rollup eligibility — 111/112 ops sharing byte-identical evidence (same header pair) didn't qualify for the spec_finding rollup (only 2 spec_findings were emitted, both declaration-gap kinds), so the operator faces 111 individually-HIGH rows for what is structurally one systemic API-wide header policy. Rollup threshold docs say '>=80% of applicable ops sharing one root cause' — worth checking whether same-check+same-evidence-shape per-op findings (not just missing_declaration/broken_baseline kinds) qualify. Evidence: zond-runs/stripe-run3-20260710/raw/30-checks-examples.json (111 open_cors_on_sensitive findings, 0 rolled up), raw/spec header dump via 'zond request GET /v1/account --api stripe'.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Resolved, no code change. Premise ('fires HIGH x111') was WRONG — the run emitted 222 findings ALL at severity LOW (verified in raw/*.json). open_cors_on_sensitive already caps at LOW for bearer/non-cookie auth via the ARV-312/316 authExposed gate (severity: authExposed ? high : low; authExposed requires an ambient cookie credential). Stripe is bearer-auth → LOW, correct per 'no evidence → no high'. Rollup part DECLINED (YAGNI + litmus): these are status-200 findings (health is fine, the gap is a header policy), so status_drift rollup semantics don't fit; adding a new spec_finding kind for a LOW hygiene finding is speculative structure. JSON/SARIF already carry the full per-op list for the agent to triage.
<!-- SECTION:NOTES:END -->
