---
id: ARV-417
title: >-
  fixtures add --validate never sends auth headers — every fixture reads back as
  'unknown' or false-stale on authed APIs
status: Done
assignee: []
created_date: '2026-07-10 12:38'
updated_date: '2026-07-10 13:13'
labels:
  - m-28
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Stripe run#3 (m-28). `zond fixtures add customer=cus_UrME8ANaDnDA4g --validate --apply --api stripe` returned validation status 'unknown, httpStatus 401' even though the same id GETs cleanly as 200 via 'zond request GET /v1/customers/cus_UrME8ANaDnDA4g --api stripe' and via a plain curl-equivalent. Root cause confirmed in src/cli/commands/fixtures.ts addAction() validate block (~line 178-186): it builds the readback request by hand — `{ method: 'GET', url, headers: { accept: 'application/json' } }` — with NO Authorization/apiKey header, bypassing the auth-header derivation every other request path uses (zond request, checks run's h.authHeaders, send-request.ts). On any API requiring auth (i.e. virtually all of them) this makes --validate systematically wrong: a genuinely live+authenticated fixture reads back 401/403 and gets classified 'unknown' (best case, silently useless) or, on an API where anonymous GET 404s instead of 401s, would be misclassified 'stale' and a good id would get dropped. This directly undermines the documented 'manual fixture-bootstrap' workflow (skills/zond.md: 'zond fixtures add <var>=<id> --validate --apply' is the sanctioned path to classify live/stale/unknown). Fix: reuse the same auth-header resolution used elsewhere (derive from .env.yaml auth_token / api_key / .secrets.yaml, same as checks run's --auth-header derivation) before firing the validate GET. Evidence: zond-runs/stripe-run3-20260710/raw/ (fixtures add run + manual GET repro in this run's transcript).
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Fixed: fixtures add --validate now derives auth via liveAuthHeaders(ep, schemes, env) — same path every other live call uses — instead of an anonymous GET. Verified live on Stripe: fresh customer → [live 200] (was 401/unknown).
<!-- SECTION:NOTES:END -->
