# Auditing GitHub's OpenAPI spec with a coding agent

> **~50% of read endpoints return a status code GitHub's own spec never declares — and two live 200 responses fail their published schema.** A coding agent ran zond against GitHub's official OpenAPI description (789 paths) read-only in ~3.5 minutes. Zero server bugs. Zero security findings. Just spec that drifted from the API it describes.

## What we did

- Target: GitHub REST API, official spec ([`github/rest-api-description`](https://github.com/github/rest-api-description), refreshed the day of the run).
- Tool: zond 0.27.1, driven by a coding agent following the `/zond-scan` convention.
- Mode: **read-only** — this was GitHub's live API on a real account, so no writes. A fine-grained read-only PAT, nothing else.
- Scope: 625 operations exercised, ~2000 depth cases, ~3.5 min of wall-clock for the depth pass.

## What we found

**Contract drift, not bugs.** Every finding is `fix_spec` — the server behaves fine, the *spec* is wrong or incomplete. That's the whole point of a hygiene scanner: it finds the gap between what the docs promise and what the API does, before a client integrating against the docs hits it.

1. **Two response bodies fail their declared schema on a live 200:**
   - `GET /orgs/{org}` returns `company: null` and `email: null`, but the spec declares both as `string` (non-nullable). Any strictly-typed client generated from this spec breaks on the first org that hasn't filled those fields — which is most of them.
   - `GET /events` payloads omit fields the schema marks required (`ref_type`, `full_ref`, …) because the real payload is a union across event types that the single declared shape doesn't capture.

2. **~164 read endpoints return undeclared status codes.** `GET /app` → 401, enterprise billing endpoints → 402 Payment Required, dozens of nested resources → 403/404 — none declared in the spec's `responses:`. A client that trusts the spec's declared status set won't have a branch for these.

3. **Silent tolerance of malformed pagination cursors** — `GET /user/repos` and `GET /advisories` return 2xx on garbage cursor values instead of 4xx. Minor, but a consistency gap.

**Zero of the scary stuff:** no 5xx, no auth bypass, no data leak, no security finding. Honest reporting means saying that plainly — this is spec hygiene, not a breach.

## The honest asterisks (why this is a *hygiene* tool, not a bug-bounty flex)

- **honest-2xx was ~50%** — and we tested *why*. Seeding a real repo doubled the successful reads but left the per-operation ceiling flat at ~50%. The unreached half isn't "no repo" — it's the long tail of resource-specific ids (issue/PR/gist numbers), org membership, and GitHub-App-only endpoints, none of which a read-only token on one repo can conjure. Honest coverage means saying that, not quietly reporting the higher raw-200 number.
- **The raw finding count was 1262 "status drifts" — but only 164 are real.** The rest are the scanner fuzzing unsupported methods (OPTIONS/TRACE/POST to GET endpoints). We report 164, not 1262. Inflated counts are noise; calibrated counts are signal.
- **The spec declares no `securitySchemes` at all** — GitHub documents auth out-of-band. So the spec formally under-declares its own auth. (Also meant the tool couldn't auto-wire auth from the spec — a real papercut.)

## Why it matters for a small team

You don't have GitHub's spec-tooling budget. If *their* generated-and-scrutinized spec drifts this much on nullable fields and error statuses, a hand-maintained spec on a 30-endpoint internal API drifts more. The value isn't "we found a GitHub bug" — it's "an agent caught the drift in 3 minutes, read-only, before a generated client did in production."

## Numbers (run #1, safe)

| | |
|---|---|
| operations tested | 625 |
| depth cases | ~2000 |
| honest-2xx | ~50% (311/625 ops returned ≥1 2xx) — capped by unseeded fixtures |
| server errors (5xx) | 0 |
| security findings | 0 |
| calibrated findings | 2 MEDIUM (schema drift) + 164 GET status-drift (rollup) + 2 LOW (cursor) |
| wall-clock (depth) | ~3.5 min |

---

*API hygiene scanner for small teams and their coding agents — test REST API endpoints against the OpenAPI spec, catch contract drift, track coverage.* — [github.com/kirrosh/zond](https://github.com/kirrosh/zond)
