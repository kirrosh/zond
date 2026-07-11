# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

## [0.28.0] — 2026-07-11

m-28 corpus-driven launch: every fix below came out of four live audits of
public APIs (GitHub, Vercel, Stripe, Sentry) — evidence-first, no speculative
checks.

### Added
- **`zond fuzz` (ARV-436):** property-based fuzz phase in the checks pipeline
  over fast-check — seeded (deterministic reruns), random bodies per op judged
  by the existing 12 response checks; on failure the body auto-shrinks to a
  minimal counterexample in `evidence.minimal_case` + curl repro. Thin alias
  over `checks run --phase fuzz`; shrink walk survives per-send network flakes.
- **`seed_body.setup` (ARV-434):** ordered post-create readiness steps for
  lifecycle tests ("create invoiceitem before finalizing the invoice") — agent
  authors bodies+order, zond runs them with `{{id}}` bound to the created
  resource; a non-2xx setup step skips the lifecycle test with the concrete
  step+status instead of reporting a fake finding.
- **Currency-aware money bodies (ARV-430):** generator emits
  `{{account_currency}}` (manifest source: body-value, `usd` default) so
  non-USD sandboxes stop 400-ing every money create; `.env` scaffold now seeds
  any manifest `defaultValue` (was always blank).

### Safety (live-mode hardening from the Vercel run)
- **Unsafe smoke suites disarmed by default (ARV-412):** every destructive
  step in `smoke-*-unsafe` gets `skip_if "{{zond_allow_unsafe}} != 1"` — a
  naive `zond run` can no longer DELETE/PATCH pre-existing resources bound to
  raw `.env` fixtures. `/zond-scan` live runs with `--exclude-tag unsafe`
  (ARV-413).
- **Self-cleanup parity (ARV-415, ARV-429):** checks coverage phase
  best-effort DELETEs resources its own 2xx POSTs created; mass-assignment
  probe cleanup returns an audit record (id + deletePath + status).
- **`always:true` cleanup gated on capture provenance (ARV-428):** never fires
  against a stale env id the create step did not capture this run.
- **`--safe` marks write steps as skipped with a reason (ARV-427)** instead of
  deleting them from the plan silently.

### Fixed
- **lifecycle_transitions (ARV-433):** an overlay with actions but an empty
  transitions graph no longer flags every legitimate action as
  `forbidden_transition`; transition-drift repro (declared→open, observed→paid)
  locked in with a test.
- **Fail-fast on unresolved request vars (ARV-414):** kills the multi-minute
  retry_until spin on never-created resources; `--strict-vars` abort still
  writes the `--output` artifact.
- **Coverage accounting (ARV-409, ARV-426):** `--union` no longer aborts a
  checks-only session (audit HTTP touches count as `run_kind='check'`);
  RowBucket carries `passStatus` so covered2xx stops contradicting
  chronological lastStatus.
- **cross_call_references (ARV-416):** empty/non-object 2xx readback skips
  (broken-baseline guard) instead of reporting maximal drift.
- **fixtures add --validate (ARV-417, ARV-423, ARV-424):** derives auth via
  liveAuthHeaders; resolves the readback endpoint via the manifest's
  affectedEndpoints (namespaced vars validate again); each path-var resolves
  from its own env var, so an empty sibling is reported, not misattributed.
- **Misc:** shared soft-delete detection in verify+validate (ARV-418);
  `checks run --report json --output` writes the file (ARV-419); `add api`
  merges an existing `.env.yaml` + `.bak` instead of clobbering (ARV-422);
  form/query numeric coercion (ARV-431); `db run --json` includes bodies
  (ARV-432).

### Docs
- Case studies: GitHub (safe), Vercel (live), Stripe money-lifecycle deep-dive
  (`docs/case-studies/`), linked from README.
- Head-to-head: zond vs Schemathesis on live Stripe, honest gap-list both ways
  (ARV-407).

## [0.27.1] — 2026-07-09

m-27 Bucket E (agentic discoverability): metadata release — no engine changes.

### Added
- **Claude Code plugin / self-serve marketplace (ARV-395):**
  `.claude-plugin/{plugin,marketplace}.json` — install skills via
  `/plugin marketplace add kirrosh/zond`; skills mirrored to root
  `skills/<name>/SKILL.md` (synced from init templates, drift-checked in
  `bun run check`), also picked up by SkillsMP / `npx skills add kirrosh/zond`.
- **Agent discovery files (ARV-394):** `llms.txt` (machine index of docs) and
  `context7.json` (Context7 config with agent rules) at the repo root.

### Changed
- **Agentic metadata (ARV-393, ARV-400):** canonical tagline in npm
  `description`, task-shaped `keywords`, `repository`/`homepage`/`bugs` links;
  agent-first README top (what → when → install → minimal example).

## [0.27.0] — 2026-07-09

m-27 start-distribution: every install channel works on a clean machine,
one-run release pipeline, cold-start onboarding pass. Engine untouched.

### Added
- **npm channel for node-only users (ARV-386):** the published package is a
  thin node launcher (`bin/zond.mjs`) + `postinstall` that downloads the
  platform binary from the matching GitHub release and verifies its sha256
  against `checksums.txt` (`ZOND_DOWNLOAD_BASE` override for mirrors/E2E).
  Zero runtime deps, no `src/` TS execution, no bun required.
- **Full platform matrix (ARV-388):** releases now ship `darwin-x64` and
  `linux-arm64` on top of `darwin-arm64`/`linux-x64`/`win-x64`, cross-compiled
  via `bun build --compile --target`. `install.sh` fails with a clear message
  + releases link instead of a raw 404; `install.ps1` falls back ARM64 → x64
  with an emulation note.
- **One-run release pipeline (ARV-389):** tag push cross-compiles all 5
  targets, adhoc-codesigns darwin, emits `checksums.txt`, attaches everything
  to the GH release and publishes npm — documented in `docs/ci.md`. A brew
  formula generator (`scripts/release/generate-brew-formula.mjs`) is in-repo
  but the channel is deferred until first users (ARV-387); its pipeline step
  self-skips while `TAP_GITHUB_TOKEN` is unset.
- **`zond audit --safe` (ARV-390):** explicit alias of the default safe mode
  (docs and skills always said `--safe`, but the flag didn't exist — a
  stranger's first command died on `unknown option`). Conflicts with `--live`.
- **Strict-TLS opt-in (ARV-367):** runtime HTTP keeps lax TLS by default
  (internal/dev targets behind corp CAs); `ZOND_STRICT_TLS=1` turns
  certificate verification on for public-API audits. Documented as a TLS
  policy section in ZOND.md + the zond-checks skill.
- **Raw-apiKey hint (ARV-367):** `doctor` warns when a securityScheme is
  `apiKey` in the `Authorization` header — set `auth_token` to the RAW key,
  no `Bearer ` prefix.

### Fixed
- **Serializer dropped OPTIONS/HEAD/TRACE method keys (ARV-390):** emitted
  probe-methods suites failed the runner's own validation and were skipped
  with a scary warning on a stranger's first run. Empty `json: {}` bodies no
  longer degrade to a bare `json:` (null). Round-trip regression tests added.
- **Cold-start dead-ends (ARV-390):** `init` next-steps now end at
  `zond audit --api <name> --safe`; `doctor`'s all-set output points at the
  same next action instead of stopping silently.

### Docs
- **README distribution pass (ARV-391):** install matrix (curl/npm/win/manual),
  safe-by-default trust note above the fold, animated SVG terminal demo
  (`docs/demo.svg`), one-liner positioning for strangers.

## [0.26.1] — 2026-07-09

Follow-up from the v0.26.0 petstore verify audit (report-zond findings).

### Fixed
- **`zond run` on a non-existent path is now a hard error (ARV-383):** a path
  absent on disk exits 2 with `No such file or directory: <path> — nothing to
  run`, instead of falling through to the ARV-357 empty-report path and
  reporting a green 0-test "pass". Real trigger: a probe that matched 0 fields
  never created its output dir, then `zond run <that-dir>` went silently green.
  An existing-but-empty dir keeps its ARV-357 advisory exit-0 behavior.

## [0.26.0] — 2026-07-09

Deterministic gap-fills surfaced by a docgen-core-service audit — all pass the
litmus test (same input → same output, no severity/FP/blame judgment). Plus an
m-25 distribution cleanup that collapses the workspace layout to one convention.

### Added
- **Multi-spec merge (ARV-375):** `zond add api <name> --spec a --spec b …`
  unions N specs into one audit target. Deterministic last-wins on path /
  component collisions, surfaced as warnings (path collisions + same-name /
  different-shape schema collisions). Core in `src/core/spec/merge-specs.ts`.
- **`zond secrets set <key> <value>` (ARV-377):** writes `apis/<name>/.secrets.yaml`
  with a `.bak` backup, never echoes the value, and auto-strips a pasted
  `Bearer ` prefix (`--literal` keeps it verbatim). Closes the "hand-rolled
  python to rotate an expired token" gap and ARV-367/AC3.
- **`zond db diagnose --union <spec>` (ARV-380):** aggregate
  `by_recommended_action` (+ summary counts, deduped examples) across a run
  set, reusing coverage's `--union` vocabulary (`session` / `since:<dur>` /
  `tag:<name>` / `runs:<ids>`). `--api` scopes `since:`/`tag:` to a collection.
- **Coverage deprecated flags (ARV-379):** `coverage --json` now carries a
  per-entry `deprecated` boolean on the `*Endpoints` bucket arrays plus a
  top-level `deprecatedEndpoints` list, so a consumer can split "real gap"
  from "deprecated, skip by design" without re-reading spec.json.

### Fixed
- **`db diagnose --union` version follow-up + candidate-surfacing (ARV-381/382):**
  disambig's parent-walk now skips version segments (`/v30/{code}`), aligning
  with `owningCollectionForPathParam` which already strips them — resolves the
  `_v30_code` miss-no-list class. And when prepare-fixtures can't confidently
  derive an owner list, the item carries `candidates[]` — plausible GET/list
  endpoints ranked by proximity (deprecated ones marked) — instead of
  dead-ending; zond surfaces the evidence, the agent picks the value. On
  docgen-core-merged: `miss-no-list` 40 → 22 total, 9 of those now carry
  candidates, the rest are honest dead-ends (no listable source in the spec).
- **Resource graph misses `/list`-style owners (ARV-376):** `resolveOwnerListPaths`
  now links `/list` (and `/search`, `/find`) endpoints to their sibling
  `/{code}` and `/byid/{id}` params; the `byid` accessor marker no longer
  collapses every read-by-id param into one global `byid_id`; a malformed spec
  whose path template (`/byid/{id}`) disagrees with the declared param name
  (`byid_id`) is reconciled to the template; secondary lookup keys (`{code}`)
  surface as candidates. On the docgen-core-merged spec this cut
  prepare-fixtures `miss-no-list` from 40 → 30.
- **`fixtures add` batch (ARV-378):** confirmed `fixtures add <pairs...>`
  already applies N `key=value` pairs in one call (one write + one `.bak`) —
  no shell loop needed.

### Removed
- **Flat `zond.db` workspace layout (m-25):** dropped the legacy root-level
  `zond.db` marker and its implicit default-DB resolution. The DB now lives
  only at `.zond/zond.db`; `zond.config.yml` / `.zond/` / `apis/` remain the
  workspace markers. Migrate an old workspace with `mv zond.db .zond/` (or
  re-`zond init`); an explicit `--db <path>` still opens any file. Removes the
  dual-layout confusion that let a root `zond.db` and `.zond/zond.db` coexist.
- **Dead `benchmarks/` references (m-25):** pruned the never-committed
  `benchmarks/**` entries from `knip.json` and the dead `bench:api` script from
  `package.json` (`knip` is now clean).

## [0.25.0] — 2026-07-07

m-24: **rebuild around the agent.** zond becomes a set of deterministic
dumb tools — it sends requests, validates schemas, stores and diffs runs,
and reports gaps. The autonomous heuristic layer that produced most of the
0.24 bug-stream (auto-discovery/seed/cascade, annotate-auto guess-engine,
severity calibrators, anti-FP suppression) is removed; the agent now owns
every judgment call (severity, spec-vs-backend blame, "is this a false
positive?", which value fills a fixture). The deterministic core —
send → validate → store → diff — survives intact. A litmus test in
`src/CLAUDE.md` keeps the heuristic layer from creeping back one
"reasonable" fix at a time: same input → same output, or it's the agent's.

### Removed (heuristic layer)
- **Autonomous fixture seed/cascade engine gone (ARV-336):** `bootstrap.ts`
  + `create-body.ts` deleted. Live-POST resource creation guessed bodies and
  cascaded parent→child (1% success on Stripe). prepare-fixtures is now
  single-pass verify + gap-report; the agent (or user) creates resources.
- **Severity calibrators + anti-FP suppression gate removed (ARV-337 Cut A):**
  severity is agent judgment; anti-FP `applyAntiFp` no longer gates emission —
  the rule reasons survive as raw evidence, not as a suppress-or-emit verdict.
- **annotate-auto guess-engine removed (ARV-337 Cut B):** `inferSeedBody`
  fabricated bodies from format/name fallbacks and self-ranked confidence.
  annotate now dumps the spec slice; the agent authors the YAML, zond
  validates and merges.

### Agent-facing artifacts & new mechanics
- **YAML run summary (ARV-338):** `zond db diagnose` drops prose hints (keeps
  the mechanical counts/grouping spine); `db … --report yaml` emits
  agent-friendly output.
- **Field-level run diff (ARV-339):** `zond db compare` now diffs response
  body/schema per field, not just status.
- **prepare-fixtures gap report (ARV-349/350):** undefined vars + unseeded
  capture-chain roots are reported deterministically — no auto-seed.
- **Agent-orchestrated auto-seed (ARV-355):** `zond request --capture` +
  `zond-seed` skill — the agent reasons about creation order, zond executes.
- **Ambiguous-id guard (ARV-334):** the hint-less fixture harvest reports
  `miss-ambiguous-id` (naming the candidate string field) instead of silently
  putting a numeric `id` into a string slot like `{owner}` — zond flags the
  ambiguity, the agent/annotation picks the field.
- **generate preserves hand-edits (ARV-361):** suite files whose auto-gen
  header was removed are treated as agent-owned and preserved on regenerate;
  `--force` overwrites them (was a documented no-op).

### Checks, probes & safety
- **`--safe`/`--live` parity (ARV-299)** across `checks run` and `probe`.
- **stateful scope (ARV-325):** `--check stateful` expands to the
  state-machine set only.
- **cascade fast-fail (ARV-326):** prepare-fixtures aborts early on a
  dead/scoped-wrong token instead of grinding through futile attempts.
- **input-triggered 5xx caught (ARV-340/341):** self-generated body rejects
  route to `fix_spec`, not `report_backend_bug`.
- **child-exclude wired (ARV-330):** the last-attempt history lookup uses the
  all-run-kinds query + child-exclude pattern so probe sub-resource POSTs
  (`/v1/accounts/{id}/reject`) don't starve the real create-path window.
- **checks reporting fixes (ARV-322/323/328):** suppressed-count accuracy,
  SIGTERM ndjson counting, throttled stderr progress on long runs.

### Sweeps & infrastructure
- **Bounded/resumable sweeps (ARV-342):** `--skip-ops` / `--max-ops` op-window.
- **DB retention (ARV-266):** `zond db prune` + `zond db stats`, per-run-kind
  cutoffs, VACUUM after delete.
- **Schema from observed runs (ARV-175/176):** `schema-from-runs` command +
  `refresh-api --merge-schema` — union/required-intersection from real
  responses, not guessing.

### Report, triage & audit-run cleanup
- Report-noise, severity and UX cleanup (ARV-343/344/345/346/348/351/353);
  compare scope tag, partial summary on SIGTERM, triage depth aggregate
  (ARV-352/354).
- Empty-dir `zond run --output` writes a `0 tests` envelope instead of no
  file (ARV-357); cross-phase double-emit documented for triage (ARV-358).
- Workspace-leak fix (env-independent audit paths) + self-compare guard
  (ARV-359/360), from a petstore audit-run.

## [0.24.0] — 2026-07-03

m-22 validation sprint. No new milestone surface — this release hardens the
0.23.0 depth-checks/probe/audit stack against real APIs. ~40 fixes (ARV-260..332)
were found by running `zond audit`/`zond-scan` live against Stripe, GitHub,
Resend and docgen-core, not by unit tests.

### Safety & contracts
- **Safe-mode leak closed (ARV-332):** `checks run --check stateful --include
  method:GET` no longer fires POST create-chains — CRUD groups are built from
  the filtered op set, so `ensure_resource_availability`/`use_after_free`
  self-skip when no write is in scope. Critical for scanning APIs you don't own.
- Exit-code contract hardened (ARV-303/307/308/309/310): audit judges stages on
  `envelope.ok`, not raw exit code; budget-exhaust distinguished from network error.
- `open_cors_on_sensitive` HIGH only on 2xx + ambient (cookie) credential
  (ARV-312/316) — kills a class of false HIGHs.

### Severity calibration
- Probe-side severity calibrator (ARV-283/300): `SecuritySeverity ↔ Severity`
  adapter with sentinel passthrough; wired into security probe. mass-assignment/
  static/webhooks tracked in ARV-311.

### Fixture / seed pipeline
- FK-aware body builder wires reference fields to fixtures (ARV-45).
- Topological seed order + body-FK deferral (ARV-324/327); gap-report flags
  unfillable complex root resources instead of silently skipping (ARV-329/330).

### Ops & workflow
- `ZOND_WORKSPACE` honored; `zond-audit` workflow added for reproducible runs.
- ndjson reporter stability (ARV-314/318/320/322); path-casing canonicalized
  before workspace-root walk (ARV-315).
- Repo-wide ponytail cleanup: dead code removed, probe monoliths deduped.

## [0.23.0] — 2026-05-15

Big release covering m-15 → m-21 (155 ARV tickets across depth-checks,
schemathesis-comparison, m-20 stateful probes, agent-augmented annotation,
deep-testing-and-tuning). The detailed per-task list survives below
under the legacy TASK-* headings (m-13 carry-over); this section is the
release-summary for the m-15..m-21 epic series.

### Highlights — m-15 to m-21

#### `zond checks` — schemathesis-style depth checks (m-15, ARV-1..12)

- **17 registered checks** across two registries: per-response
  (`status_code_conformance`, `content_type_conformance`,
  `response_headers_conformance`, `response_schema_conformance`,
  `missing_required_header`, `unsupported_method`, `negative_data_rejection`,
  `positive_data_acceptance`, `not_a_server_error`,
  `rate_limit_headers_absent`) and stateful (`ignored_auth`,
  `use_after_free`, `ensure_resource_availability`, `cross_call_references`,
  `idempotency_replay`, `pagination_invariants`, `lifecycle_transitions`,
  `open_cors_on_sensitive`).
- **Anti-FP infrastructure** (`core/anti-fp/`) with per-rule registry,
  6 documented schemathesis-FP fixture-pack regressions
  (`tests/regression/schemathesis-fps/`), and per-finding `recommended_action`
  enum (`fix_test_data` / `fix_test_logic` / `report_to_api_owner` / …).
- **Coverage phase** (`--phase coverage`) for deterministic boundary-value
  enumeration over body + param schemas; complements `--phase examples`.
- **SARIF v2.1.0 reporter** with stable `partialFingerprints` for GitHub
  Code Scanning integration.
- **NDJSON streaming reporter** (`--report ndjson`) with published
  JSON Schema (`docs/json-schema/ndjsonEvent.schema.json`).
- **`--workers` async-pool** for op-level concurrency, gated by an
  optional `--rate-limit auto` adaptive limiter (RFC 9568 RateLimit-* headers).
- **`--include` / `--exclude` selectors** unified across `generate`, `run`,
  `checks` (path/method/tag/operation-id grammar).

#### m-18 — schemathesis parity baselines (ARV-174..186)

- Stripe / Resend / Sentry parity baselines (3 baseline-fixed bugs:
  ARV-179 unsupported_method exhaustive enumeration, ARV-180
  status_code_conformance param-axis coverage, ARV-181 ignored_auth
  pathVars + strict-401, ARV-183 phantom-findings fix, ARV-184
  missing_required_header exhaustive). Documented schemathesis-V4
  comparison matrix.

#### m-20 — stateful probes (ARV-169..173, 187, 191)

- **`cross_call_references`** (ARV-169) — POST→GET shape-diff probe.
  Surfaces `state_not_persisted` (HIGH) when the server echoes a field on
  create but drops it on read.
- **`idempotency_replay`** (ARV-170) — `Idempotency-Key` honor probe.
  Two POSTs with the same key must return the same id and bit-identical
  response (`duplicate_resource` / `non_bit_identical`).
- **`pagination_invariants`** (ARV-171) — cursor-style page consistency.
  Detects off-by-one duplicates across pages, partial-page-with-has_more,
  and inconsistent has_more.
- **`lifecycle_transitions`** (ARV-172) — declared state machine
  verification with action-replay idempotency probe.
- **`probe webhooks`** (ARV-173) — webhook shape-conformance against
  `spec.webhooks` event log; recipe in `docs/recipes/webhook-receiver.md`.
- **`zond api annotate`** (ARV-187) — agent-augmented annotation flow:
  `dump` slices spec for the agent, `apply` merges its YAML answers into
  `.api-resources.local.yaml` (no LLM inside zond — see
  `feedback_zond_no_llm_calls` memory).
- **Form-encoded stateful checks** (ARV-191) — stateful probes honor
  `requestBodyContentType` so Stripe-style APIs aren't broken-baseline.
- **`.api-resources.local.yaml` `patches:` block** (ARV-169) — field-level
  overlay survives `refresh-api`; replaces the deprecated re-declaration
  pattern.

#### m-21 — deep-testing-and-tuning (ARV-188..256)

- **Severity rebalance** (ARV-250..256) under "no-OOB" constraint —
  small-team API hygiene scanner positioning. SSRF / CORS / rate-limit
  / missing-auth probes recalibrated; `report categorization` into
  security / reliability / contract / hygiene buckets (ARV-251).
- **Spec-lint cap at LOW/INFO** (ARV-255) — dedicated `zond lint` command
  separates static spec hygiene from runtime probes.
- **Mock-API testbed** (ARV-193) — `apis/_mock/` with 4 intentional bugs
  per m-20 stateful probe; `tests/regression/mock-testbed.test.ts` is the
  regression-floor for probe-quality.
- **`zond fixtures add` / `import --from-curl`** (ARV-195) — manual
  fixture-bootstrap for path-FK ids that auto-discover/--seed can't reach
  (vendor-dashboard ids).
- **Stripe form-encoding fix** (ARV-196) — bootstrap seed POST honors
  `application/x-www-form-urlencoded` with bracket nesting
  (`card[number]`, `items[0][price]`).

### Performance & operability

- **`--max-requests` cap** for `zond checks run` (ARV-227) — shared
  budget for per-response + stateful phases bounds long runs against
  large specs (github / kubernetes).
- **Schema-validation safety net** (ARV-214) — oversized response schemas
  in `--validate-schema` skip with a stderr warning instead of hanging
  for 15+ min on AJV.compile. Configurable via
  `ZOND_VALIDATE_SCHEMA_MAX_BYTES` (default 1 MiB) and
  `ZOND_VALIDATE_SCHEMA_SLOW_COMPILE_MS` (default 1000ms).
- **Rate-limiter adaptive mode** (ARV-8 follow-ups) — paces from
  `RateLimit-*` response headers (RFC 9568) so multi-worker runs respect
  vendor budgets globally.

### Skills & workflow

- Skills consolidated 5 → 3 (`zond`, `zond-checks`, `zond-triage`) with
  `zond init --prune-stale-skills` (ARV-197) for upgrades.
- Skill `update-on-feature-change` ritual formalized; per-feature CLI
  changes gate on skill update (`feedback_update_skills_per_feature`
  memory).
- Iron rules in `skills/zond.md`: `--dry-run` for destructive ops,
  `--redact-identity` for triage artefacts, mandatory
  `zond doctor --missing-only` first step.

### Fixed (selected)

- ARV-145: `zond add api` no longer crashes on cyclic OpenAPI specs
  (Stripe). `decycleSchema` writes `x-circular` sentinel; downstream
  parsers skip cleanly.
- ARV-200: extractEndpoints filters `x-circular` param stubs (R10/F1
  feedback-loop crash).
- ARV-209: `--validate-schema` auto-resolves spec from
  `apis/<name>/tests/` path (R12/F11 — manual `--spec` no longer
  required for skill-driven runs).
- ARV-244: `cleanup --orphans` percent-encodes unsafe characters in
  `deletePath`.
- ARV-238: `clean --api <name>` resolves global `--api` fallback.
- 50+ feedback-loop bug fixes from R01..R18 against Resend / Sentry /
  Stripe / GitHub baselines (search `git log --grep "R[0-9]\+/F"` for the full list).

### Workspace contract

- **Manifest vs values** (m-17, decision-7) — `.api-fixtures.yaml` is
  the manifest of required vars; `.env.yaml` carries values. The split
  is enforced by `prepare-fixtures` ("not in manifest, ignored" warning)
  and documented in `skills/zond.md`.
- **`.api-resources.local.yaml`** (ARV-111) — survives
  `add-api`/`refresh-api`. Use `extensions:` for full resource entries,
  `patches:` for field-level overlays (readback_diff, idempotency,
  pagination, lifecycle, seed_body).
- **Single API-resolution chain** (TASK-290) — `--api` flag → `ZOND_API`
  env → `.zond/current-api` (set by `zond use <name>`).

---

The legacy m-13 TASK-* changelog continues below; entries originally in
`[Unreleased]` are now part of 0.23.0.

### Added

- **TASK-301: workspace defaults for `--timeout` and `--rate-limit` in `zond.config.yml`.**
  New `defaults.timeout_ms` and `defaults.rate_limit` (alias `timeoutMs`,
  `rateLimit`, `rate_limit: auto`) feed `cleanup`, `prepare-fixtures`,
  `probe mass-assignment`, `probe security`, `request`, and `run`.
  Resolution chain: **CLI flag → `apis/<name>/.env.yaml` meta → workspace
  defaults → built-in fallback** (30000 ms / undefined rate limit).
  `.env.yaml` already supported `rateLimit:`; now also supports
  `timeoutMs:`. The init template's `zond-config.yml` documents the
  `defaults` block. New helpers: `loadWorkspaceDefaults`,
  `resolveTimeoutMs`, `resolveRateLimit` in `core/workspace/config.ts`.

### Changed (breaking)

- **TASK-300: `zond probe validation` and `zond probe methods` are merged into `zond probe static`.**
  Both classes are static-input checks (no HTTP) and now share one entry
  point: `zond probe static --output <dir>` runs both by default. Filter
  via `--include validation,methods` (or `--exclude`). The old subcommands
  are removed without a deprecation alias — same model as TASK-298
  (`validate` + `lint-spec` → `check`). `zond audit` now spawns a single
  `probe static` stage (output dir `apis/<name>/probes/static/`) in place
  of the two former stages.

- **TASK-299: `zond discover` and `zond bootstrap` are merged into `zond prepare-fixtures`.**
  Single-pass discover is now `zond prepare-fixtures --api <name>` (the
  former `zond discover` flow). Multi-pass cascade is `--cascade`, with
  `--seed` / `--force` / `--max-passes` (the former `zond bootstrap`).
  `--seed` implies `--cascade`. The old top-level commands are removed
  without deprecation. `zond audit --seed` now spawns
  `prepare-fixtures --apply --seed` instead of `bootstrap`.

- **TASK-298: `zond validate` and `zond lint-spec` are merged into `zond check`.**
  Use `zond check tests <path>` for the YAML-test schema validator and
  `zond check spec [spec]` for the OpenAPI static analyser. The old
  top-level commands are removed (no deprecation alias). Flag surface is
  unchanged. Single mental model — both surfaces are conformance checks
  on workspace inputs, neither makes HTTP calls.

### Removed (breaking)

- **TASK-284: `zond serve` and the WebUI are removed.** Agent-first / CLI-only
  surface per vector-3. Use `zond report export` for shareable HTML reports.
  `src/ui/` is gone along with hono / react / tanstack / tailwind dependencies.
- **TASK-285: `zond update` (and `self-update` alias) is removed.** Use the
  system package manager: re-run `install.sh`, or `npm install -g @kirrosh/zond@latest`,
  or `bun install -g @kirrosh/zond@latest`. README has the upgrade section.
- **TASK-286: `zond export postman` is removed (decision-4 reversed).** The
  parallel YAML→Postman exporter (`src/cli/commands/export.ts` +
  `src/core/exporter/postman.ts`, ~963 LOC) had no measured demand;
  OpenAPI-driven tooling already covers the round-trip use case.
- **TASK-287: `zond report case-study` standalone subcommand is removed.**
  The case-study markdown drafts are still produced by `zond report bundle`
  (default `--include case-study`); the per-failure CLI surface and its flags
  collapse into the bundle path. `renderCaseStudy` core renderer is unchanged.

### Removed (breaking)

- **TASK-288: deprecated top-level `probe-*` aliases removed.** The
  one-release deprecation window for `probe-validation`, `probe-methods`,
  `probe-mass-assignment`, `probe-security` (TASK-182) is closed. Use
  `zond probe <class>` instead. `warnDeprecatedProbe` helper removed.

### Changed (breaking)

- **TASK-296: `--json` envelope `errors[]` is now structured.** Every
  error is `{ code: ZondErrorCode, message: string, details?: object }`
  instead of a flat string. `code` is a closed enum
  (`unknown_error`, `env_missing`, `fixture_missing`, `network_timeout`,
  `network_error`, `sandbox_blocked`, `spec_load_failure`,
  `yaml_parse_error`, `workspace_not_found`, `file_not_found`,
  `permission_denied`, `argument_invalid`, `api_not_registered`,
  `db_error`, `auth_config_error`) so an agent can route on `code`
  without parsing the human message. Agents that previously did
  `errors[0]` now read `errors[0].message`. Sites not yet classified
  emit `code: "unknown_error"` (still structured, still routable).

### Added

- **TASK-294: `recommended_action` field on every Issue / SecurityFinding /
  mass-assignment / discover finding.** Closes the agent-routing gap
  for findings outside `db diagnose`. New enum values: `fix_spec`,
  `fix_fixture`. See `skills/zond.md` for the full table.

- **TASK-292: 5 iron rules in `skills/zond.md`.** Promotes from
  audit-and-consolidation §6: NEVER destructive ops on shared/prod org
  without `--dry-run`; NEVER report cleanup-failure as API bug; NEVER
  share triage artefacts without `--redact-identity`; MUST timeout
  bootstrap cascade (default 8 passes); MUST run
  `zond doctor --api <name> --missing-only` first. Each has a one-line
  rationale embedded next to the rule.

- **TASK-290: global `--api` flag + `ZOND_API` env + `.zond/current-api` file.**
  `zond` now resolves the active API from a single chain (highest wins):
  per-command `--api` > root `--api` > `ZOND_API` env > `.zond/current-api`
  (set by `zond use <name>`; was `.zond-current` at workspace root).
  The root `--api` value is mirrored into `ZOND_API_GLOBAL` by a preAction
  hook so deeply-nested code can read it without a `cmd` reference.

### Deprecated

- **TASK-289: `zond run --no-real-parents` → `--use-synthetic-parents`.**
  Double-negative renamed to a positive flag. The old name still works
  one release with a stderr warning, then drops.
- **TASK-291: `zond lint-spec --filter-rule` is a deprecated alias for
  the whitelist subset of `--rule`.** The two flags are unified: `--rule`
  now accepts `B1` (whitelist), `!B2` (disable), `B3=high|low|off` (override).
  `--filter-rule` still works one release with a stderr warning.

### Added

- **TASK-29: `zond db diagnose --json` now surfaces `suggested_fixes`.**
  Two actionable signals on top of the existing `agent_directive` /
  `recommended_action` / `env_issue` envelope:
  (1) **placeholder path-params on 404s** — when a 404 hits a URL still
  containing literal `example`, all-zero UUIDs, `your-…-here`,
  `replace-me`, or sentinel hex tails (`…dead/beef/cafe`), the segment
  is flagged with a fix message pointing at `zond discover --apply` or
  the matching fixture in `.env.yaml`. Deduplicated across failures so
  one broken segment doesn't repeat N times.
  (2) **unfilled `.env.yaml` keys** — reads the API's `.env.yaml` and
  flags values that are empty, `<TODO>` / `<…>`, `example`,
  `your-…-here`, or `replace-me`. The agent gets a concrete list of
  keys to fill before re-running, instead of guessing from a 404 burst.

- **TASK-36: tagless endpoints fall back to per-resource grouping.**
  `groupEndpointsByTag` previously piled every untagged endpoint into a
  single `untagged` bucket — Resend's `/audiences` POST/GET/DELETE all
  ended up in one fat `smoke-untagged.yaml` instead of a focused
  `audiences-smoke` / `crud-audiences` pair. Untagged endpoints now key
  by their first non-templated path segment (`/audiences/{id}` →
  `audiences`, `/{tenant}/jobs/{id}` → `jobs`), so tagless specs
  produce the same per-resource suite layout as tagged ones. Path of
  `/` keeps the legacy `untagged` key.

- **TASK-116: `zond run --all` + CI context autodetection.** `--all`
  discovers every `apis/<name>/tests/` directory in the workspace and
  merges them into a single `runs.id` — one run row per CI invocation,
  even with multiple registered APIs (without it, each `zond run` lands
  on its own row, so cross-build comparison is impossible). On every
  `zond run` the CLI now also stamps the run row with CI context
  auto-detected from env vars (GitHub Actions, GitLab CI, CircleCI,
  Buildkite, Jenkins, or generic `CI=true`): `trigger=ci`, `commit_sha`,
  `branch`. Manual runs still default to `trigger=manual` with no
  commit/branch. `ZOND_TRIGGER` / `ZOND_COMMIT_SHA` / `ZOND_BRANCH`
  override autodetection for wrappers that strip the native vars.
  `RunFilters` gained `trigger`, so `listRuns({ trigger: "ci" })` /
  `zond db runs --trigger ci` (UI/CLI filter) limits the dashboard to
  CI rows.

- **TASK-142: `zond request --validate-schema` and `--validate-against "METHOD:/path"`.**
  One-off ad-hoc requests can now check the response body against the
  OpenAPI response schema without wrapping the call in YAML. Auto-resolves
  the endpoint from request method + URL.path (templated paths like
  `/users/{id}` matched via the same regex used by `run --validate-schema`).
  Selects the response branch from the actual status code (200 → 200 schema,
  404 → 404 schema, anything else → `default`). Output adds a
  `Schema validation: PASS / FAIL` block with the matched endpoint,
  response branch, and human-readable schema errors (`schema.required`,
  `schema.type`, etc.). FAIL → exit 1; `no-endpoint`/`no-spec`/`no-schema`
  → soft no-op with a one-line hint. `--validate-against` overrides the
  auto-resolver when the URL doesn't fit the spec template (e.g.
  parameterized resources fetched by slug). Requires `--api <name>` —
  the spec is loaded from the registered collection.

- **TASK-143: `zond report bundle <range>` — batch triage exporter.**
  One command instead of `4 runs × 2 formats = 8 calls`. Range forms:
  `A..B` (inclusive numeric range), `A,B,C` (comma list), or
  `--session <id>` (resolve all runs from a CLI session via `runs.session_id`).
  For each run writes `<dir>/<run-id>/case-study.md` (only when failures
  exist), `<dir>/<run-id>/report.html` (single-file HTML), and
  `<dir>/<run-id>/diagnose.json`. A top-level `index.md` lists run-id /
  spec / totals / artefact links / agent_directive snippet from
  `diagnose`. `--include` filters the artefact set (subset of
  `case-study`, `export`, `diagnose`); `--body-cap`/`--no-body-cap`
  forwards to both case-study and HTML renderers. Default output dir
  is `triage/bundle/<timestamp>/` when `--output` is omitted.

- **TASK-146: `probe mass-assignment --emit-template "METHOD:/path"`.**
  Generates a ready-to-edit YAML probe template for one endpoint, so the
  user doesn't have to copy-paste the boilerplate from the skill (Phase
  5.1) when the auto-prober marked a verdict INCONCLUSIVE / INCONCLUSIVE-5XX.
  For POST endpoints with discoverable item path (GET-by-id / DELETE
  counterpart) the emitter produces a full `create → verify → cleanup`
  chain with `always: true` cleanup. Privileged-field injection is the
  union of (a) classic mass-assignment vectors (`is_admin`, `role`,
  `owner_id`, …) and (b) `readOnly: true` / `x-zond-protected` properties
  lifted from the request body schema. Output to stdout by default, or
  `--output <file>` to write a YAML file directly. Note: the body
  serializer was tightened so `not_equals: true` (boolean) no longer
  silently emits as `not_equals: "true"` (string) — assertions against
  real boolean fields now compare correctly.

- **TASK-153: `probe security` fuzzy-echo classifier for CRLF.** The echo
  detector previously used verbatim substring match, which missed real
  stored-CRLF bugs when the backend stripped `\r`, URL-decoded `%0d%0a`
  before saving, or truncated the field at the first newline (only the
  tail landed in storage). The classifier now branches by class: SSRF and
  open-redirect stay verbatim (URL preserved as-is), CRLF additionally
  tries URL-decoded pairs, CR/LF normalization variants, and tail-only
  match after a newline. The match kind (`verbatim` / `url-decoded` /
  `CRLF→LF` / `CR stripped` / `tail after CRLF` / …) is recorded in
  `finding.reason` for investigation. Bodies are walked as a tree of
  string leaves so CR/LF chars aren't hidden behind JSON escape
  sequences in the haystack.

- **TASK-145: `zond doctor --missing-only` + `--query` + canonical `--json` shape.**
  The `--json` envelope is now documented as the canonical contract — all
  diagnostic data lives under `.data` (no `.diagnostics` wrapper). `--help`
  spells out every dot-path (`.data.fixtures.required[]`,
  `.data.staleArtifacts[]`, …) so agents stop guessing. **`--missing-only`**
  hides rows already healthy in both text and JSON: required fixtures with
  values, fresh artifacts, optional fixtures, and `extraInEnv` are dropped.
  **`--query <dotpath>`** resolves a subtree of the report and emits it as
  raw JSON to stdout (no envelope), so pipelines no longer need `jq` for
  the common cases (`zond doctor --query fixtures.required`,
  `--query staleArtifacts`). Unknown paths fail with exit 2 and a list of
  the canonical entry points.
- **TASK-140: `zond db run --status` now accepts ranges & classes.**
  In addition to the existing exact-code form (`--status 502`), the flag
  parses class wildcards (`5xx`, `4xx`, …), inclusive ranges
  (`500-599`), open-ended comparisons (`>=500`, `<400`, `>500`, `<=400`),
  and any comma-separated mix of those (`5xx,429`, `500,502,504`).
  Triage of large failure runs (e.g. 2000+-step Sentry hunts) no longer
  needs `jq` over `--json`. Invalid syntax produces a one-line error;
  the parser is unit-tested in `tests/cli/status-filter.test.ts`.
- **TASK-144: `zond run --retry-on-network <N>`.** Auto-retry on transient
  TCP/transport errors (`ECONNRESET`, `EPIPE`, `socket hang up`,
  `fetch failed`, abort/timeout without HTTP response) with exponential
  backoff + full jitter (base 250 ms, cap 8 s). Default `1`, set `0` to
  disable. **HTTP status codes (incl. 5xx) are NOT retried by this path**
  — 5xx is a real server response, not a flaky socket; rate-limited 429
  retries continue to flow through the rate-limiter. Retried steps surface
  `network_retry: <count>` in `--report json` and the `--json` envelope so
  flaky-network shells stay visible during triage.
- **TASK-186: unified `Exporter` interface + sanitizer pipeline.**
  `src/core/exporter/exporter.ts` now defines `Exporter<I, O>` plus a
  `runExporter()` pipeline; `applySanitizer()` is the one place
  sanitization happens. `generateJsonReport` and `generateJunitXml` are
  pure renderers that hand off to `runExporter`. The cli sites that
  used to call `redact()` directly (HTML report, case-study draft,
  probe-mass-assignment digest, probe-security digest) now call
  `applySanitizer()`, signalling the single sanitization seam. New
  exporters get sanitization for free; `redact()` is no longer imported
  from cli/exporter code.
- **TASK-184: typed `--json` envelope helpers (closes TASK-73 / TASK-74).**
  `src/cli/json-envelope.ts` now exports a discriminated-union
  `EnvelopeResult<T>` plus two new entry points: `writeEnvelope(cmd, result)`
  (writes the envelope and returns the exit code) and `withEnvelope(cmd, produce)`
  (wraps an async producer, renders thrown errors as `ok: false`).
  Existing `jsonOk` / `jsonError` / `printJson` keep working — the new
  helpers are an opt-in convenience layer for new commands. Test suite
  pins the success/error/meta/warnings shape end-to-end.

### Changed

- **TASK-187: split `src/db/queries.ts` by domain.** The 750-line module
  is now split across `src/db/queries/{types,runs,sessions,results,collections,dashboard,settings,coverage}.ts`.
  `src/db/queries.ts` survives as a façade that re-exports everything,
  so all 27 callers stay unchanged for one release; the façade will be
  deleted in the next minor (callers should migrate to the per-domain
  paths). `coverage.ts` and `settings.ts` are reserved placeholders for
  future features and ignored by knip.
- **TASK-185: extract shared probe scaffolding into `core/probe/runner.ts`.**
  The four probe cli commands (`validation`, `methods`, `mass-assignment`,
  `security`) used to each repeat: `readOpenApiSpec` → `extractEndpoints`
  → tag-filter / list-tags → mkdir output → write each suite with
  `autoGenHeader` → record in manifest. That scaffolding now lives in
  two helpers, `loadSpecForProbe` and `writeProbeSuites`, so each cli
  command shrinks to ~100 lines and the suite-emit path is identical
  across them. Live HTTP orchestration in `mass-assignment-probe.ts` /
  `security-probe.ts` is untouched.
- **TASK-183: merge `init.ts` and `init/`.** The `init` command had two
  files that looked like entry points: `src/cli/commands/init.ts`
  (handler) and `src/cli/commands/init/` (helpers). Moved the handler
  into `src/cli/commands/init/index.ts` so the directory is the
  command's only home; behaviour unchanged.
- **TASK-181: sync `install.ps1` ↔ `install.sh`.** PowerShell installer
  now detects ARM64 alongside x64 (was hard-coded to `win-x64`), wraps
  the release-tag fetch in try/catch with a useful error message, and
  matches the .sh installer's tone. The two scripts diverged in late
  April when `install.sh` gained codesign/xattr / fallback-to-local
  logic; this brings them in line for the cross-platform behaviour
  that's actually shared (detection + download + verify).
- **TASK-179: knip cleanup.** Deleted three unused barrel modules
  (`src/core/diagnostics/render-md.ts`, `src/core/parser/index.ts`,
  `src/core/runner/index.ts`), trimmed the `tailwindcss` direct
  dependency (provided transitively by `bun-plugin-tailwind`), and
  stripped 25+ unused `export` keywords across `src/core` and `src/db`
  so symbols become module-private. The historical `executeRun` runner
  in `src/core/runner/execute-run.ts` (superseded by `run.ts`) was
  dropped; only `AUTH_PATH_RE` survives. `knip.json` now treats
  `tests/`, `scripts/`, and `benchmarks/` as entries and silences
  noise on commander `*Options` types and shadcn `*Variants`.
- **TASK-178: build artefacts out of repo root.** `bun run build` now
  emits the compiled binary to `dist/zond` (was `./zond`); the
  codesign-darwin script's default arg follows. The default SQLite path
  is now `<workspace>/.zond/zond.db` (next to `.zond/manifest.json`)
  rather than `<workspace>/zond.db`. Legacy `<workspace>/zond.db` is
  still honoured if present, so existing workspaces keep working without
  a migration step.

### Removed

- **TASK-180: collapse `docs/INDEX.md` and `docs/project-backlog.md`.**
  Both duplicated content already in README + ZOND.md + AGENTS.md.
  Removed; AGENTS.md and README.md updated to point straight at
  `backlog/` and `backlog/decisions/`.
- **TASK-177: remove `.mcp.example.json`.** Leftover from the
  pre-decision-2 MCP integration. MCP support was dropped entirely; the
  example config no longer documents anything.
- **TASK-176: drop `CLAUDE.md`.** The file was a 13-line wrapper that
  pointed Claude Code at `AGENTS.md`. Modern Claude Code reads
  `AGENTS.md` directly, so the redirect is unnecessary. AGENTS.md
  remains the single source of truth for AI agents.

### Changed

- **TASK-151 round-5 follow-up: eventual-consistency retry on POST
  cleanup.** SaaS APIs that route `POST` to a write replica and read
  paths through a follower (Sentry observed this round-5) returned
  404 to immediate `DELETE` cleanup, even though the resource existed
  ~10s later. `tryCleanup` now retries 404 with two short backoffs
  (default 200ms / 1s, configurable via `cleanupRetryDelaysMs`). A
  404 that survives retries is flagged
  `persisted across retries — likely real leak`. 5xx, network
  errors, 401/403 fail fast (not transient).
- **Skill: documented CI exit codes.** Phase 5.2 now states that
  `zond probe-security` exits non-zero on either `HIGH > 0` or
  `cleanup.error > 0`, and that `grep -q "Cleanup failures"
  digest.md` is a reliable signal for the latter.

- **TASK-151 round-4 follow-up: per-field restore + cleanup-failure
  surfacing.** The first cut of snapshot+restore sent the full GET
  body back as a single PUT, which `422`'d on partial-PUT APIs (Sentry,
  Stripe) — the round-3 user re-ran the probe and found `org.name`,
  `project.name`, `project.subjectPrefix` left as the attack payload.
  Fixes:
    1. `restoreOriginal` now replays each dirty field as its own
       single-key PUT, so partial-PUT APIs accept it. Caller passes the
       set of mutated keys (full-baseline → all body keys, partial
       baseline / per-attack → just the targeted field).
    2. `findDeleteCounterpart` / `findGetByIdCounterpart` are
       trailing-slash tolerant. `POST /keys/` + `DELETE /keys/{id}/`
       now matches; previously the regex required identical slash forms
       and silently leaked DSN keys.
    3. POST cleanup failures (no DELETE counterpart, missing id, DELETE
       4xx, network error) accumulate into `verdict.cleanup.error`.
    4. `formatSecurityDigest` prints a mandatory
       `## ⚠️ Cleanup failures` section first when any verdict has a
       cleanup error, plus a `🧹 cleanup-failure` tag next to the
       verdict line in its severity bucket. The CLI now exits non-zero
       on cleanup failures (data-integrity gate, distinct from the
       HIGH-finding gate).

- **TASK-151: `probe-security` snapshot+restore cleanup for PUT/PATCH.**
  Cleanup used to be `DELETE-if-2xx`, which silently destroyed live data
  on rename'ы — a probe overwrote a Sentry DSN-key with the attack
  payload and left it that way. probe-security now does a `GET` before
  baseline (when there's a GET counterpart on the same path),
  caches the original body, and restores it via `PUT`/`PATCH` after
  every 2xx response. Strips read-only fields (`id`, `created_at`,
  `updated_at`) from the restore body, forwards `If-Match` when
  `requiresEtag` is set, and surfaces restore failures in
  `verdict.cleanup.error` so they show up in the digest. POST keeps
  the existing `DELETE`-counterpart cleanup.

- **TASK-152: `probe-security` partial-body fallback on PUT/PATCH.**
  Sentry / Stripe / GitHub-shaped APIs accept partial PUT — sending the
  spec's full body returns `422` and the proven-HIGH CRLF on
  `subjectPrefix` lands in `INCONCLUSIVE-BASELINE`. probe-security now
  retries the baseline with a single-key body per detected field; if any
  partial baseline succeeds, attacks proceed using that shape and the
  finding `reason` is annotated `[partial-body]`. Only PUT/PATCH —
  partial bodies on POST would just trip required-field validation.

### Added

- **TASK-138: `zond probe-security <classes>` — live SSRF / CRLF /
  open-redirect probes.** Replaces the markdown templates the audit skill
  used to ship for Phase 5.2/5.3 (one HIGH stored CRLF on Sentry came
  from one of those templates — but only after hand-copying it per
  endpoint). Detects vulnerable fields by name + `format` hints
  (`*_url` / `webhook` / `format: uri` for SSRF; `subject` / `*_prefix`
  / `name` / `description` for CRLF; `redirect` / `next` / `return_to`
  for open-redirect), sends a **baseline-OK** request first (skips the
  endpoint with `INCONCLUSIVE-BASELINE` if baseline ≠ 2xx — eliminates
  the 5×404 noise the markdown templates produced on scope-locked
  endpoints), then attacks each detected field with the class's
  payloads. Classifies HIGH (5xx **or** payload echoed in 2xx body —
  stored injection candidate), LOW (2xx, no echo — verify manually),
  OK (4xx). Idempotent cleanup via DELETE counterpart. `--dry-run`
  enumerates fields without sending requests. `--emit-tests <dir>`
  produces regression YAML suites with `always: true` cleanup.

- **TASK-137: `probe-mass-assignment` body-FK auto-discovery.** Required
  body fields named `*_id` / `*_slug` / `*_uuid` / `*_key` are now resolved
  pre-baseline by hitting the matching collection list endpoint
  (`audience_id` → `GET /audiences`). Eliminates most
  `inconclusive-baseline` noise, where the spec-generated random UUID was
  rejected before extras ever reached validation. Enabled by default
  (gated by the existing `--discover` / `--no-discover` flag — same as
  the path-param discovery from TASK-92). When discovery still misses an
  FK, the INCONCLUSIVE summary now lists the unresolved field names so
  the user knows exactly what to add to env. Follow-up
  `--retry-inconclusive <run-id>` tracked as TASK-150.

- **TASK-136: `zond discover --api <name>` — auto-fill `.env.yaml` FK ids
  from list-endpoints.** Phase 2.5 of an audit used to be manual: hit
  `GET /audiences`, `GET /projects`, etc., copy slugs into `.env.yaml`,
  repeat for every FK. `discover` walks `.api-resources.yaml`, finds owner
  list-endpoints for each path-FK var, calls them with the workspace
  `auth_token`, and proposes a diff. Suffix-aware extraction (`*_slug` →
  `slug`, `*_uuid` → `uuid`, `*_id` → `id`). Default dry-run; `--apply`
  writes with a `.env.yaml.bak` backup. Skips vars already filled with a
  non-placeholder value. v1 limitation: only collection-level list
  endpoints (no nested paths — that's TASK-137 territory).

- **TASK-139: `zond generate --explain`.** Prints a per-POST diagnostic table
  (`resource | post | get/{id} | put/patch | delete | list | verdict | reason`)
  without writing files, so you can debug "why didn't `generate` emit a CRUD
  chain for resource X?" against a real spec. Pairs with the relaxed
  detector below.

### Changed

- **TASK-139: relaxed CRUD detector — trailing slashes and id-like field
  names.** `detectCrudGroups` now matches `POST /alerts/` against
  `GET /alerts/{id}` (and any combination of trailing slashes), and
  `getCaptureField` looks for the path-param name (`{slug}` → `slug`,
  `{rule_id}` → `id`/`rule_id`) plus `slug`/`uuid`/`key`/`version`/`name`
  string fields before falling back to type-shape heuristics. Together
  these produce CRUD chains for Sentry-style resources (alert-rules,
  dashboards, releases) that previously fell through the strict regex.

### Changed

- **TASK-135: `probe-validation` no longer short-circuits on parent path
  params.** Probes now emit non-attacked path parameters as runtime
  placeholders (`{{organization_id_or_slug}}`) so `zond run` resolves them
  from `.env.yaml`. Previously every parent slot was baked as the
  synthetic sentinel `nonexistent-zzzzz`, which made nested-path probes
  return 404 from the parent before the leaf validator ever fired —
  hiding real 5xx bugs in `repos/{repo}/commits`-style endpoints. Use
  `--no-real-parents` to keep the legacy fully-synthetic rendering.

### Added

- **TASK-110: `zond report case-study <failure-id>` — markdown drafts for
  one failure.** Companion to TASK-107: zooms into a single `results.id`
  and produces a ready-to-edit case-study (TL;DR, spec snippet, curl,
  response, "why it matters", provenance) primed for `gh issue create
  --body-file -` or a Slack write-up. Powers a **Case study draft**
  button on the Run detail UI (clipboard via
  `GET /api/results/:id/case-study.md`). Missing fields become explicit
  `<TODO: ...>` placeholders.

- **TASK-107: `zond report export <run-id>` — single-file HTML run reports.**
  Materialises a stored run as a self-contained HTML (inline CSS + JS, no
  external assets) you can attach to a GitHub issue, drop into Slack, or
  archive offline. Includes pass-rate ring, KPI strip, collapsible failure
  cards with provenance + frozen OpenAPI excerpts, **Copy curl** and
  **Copy as GitHub issue** buttons, failure-class filter chips, and an
  endpoint × method coverage map. Light/dark themes via
  `prefers-color-scheme`; print-friendly for browser-PDF export.

### Breaking

- **TASK-73: top-level `--json` removed.** `--json` was previously a global
  option that propagated to every subcommand; on `run` it collided with
  `--report json` and crashed (`paths[0] must be of type string`). It is now
  a per-command option attached only to subcommands that produce a JSON
  envelope. **Migration**: replace `zond run … --json` with
  `zond run … --report json`. Other commands (`db diagnose --json`,
  `validate --json`, `coverage --json`, …) keep working unchanged — only
  the flag's scope changed, not its meaning.

### Round-2 papercuts continued (TASK-70 / TASK-72 / TASK-75)

- **TASK-72: `--tag` no longer silently swallows YAML parse errors.** Tag
  filter prints every parse error as a warning; if every file fails to parse
  the run exits 2; if the tag filter empties to zero AND parse errors exist,
  the run exits 1 with a message pointing at the parse failures instead of
  the misleading "No suites match the specified tags".

- **TASK-75: pre-flight `{{var}}` check + `--strict-vars`.** Every `{{var}}`
  reference is checked against env, parameterize, set keys and prior-step
  captures before a request goes out. Missing references emit a warning by
  default; `--strict-vars` makes them a hard-fail (exit 2) so CI catches
  typos before the server returns "invalid email format".

- **TASK-70: env_issue overrides per-failure recommendation.** When
  `db diagnose` detects a run-level env_issue, every non-5xx failure's
  `recommended_action` becomes `fix_env` and the misleading per-failure
  hint/schema_hint is suppressed. Real backend bugs (5xx) keep
  `report_backend_bug`.

## [0.22.0] — 2026-04-29

### Round-2 papercuts (TASK-68 → TASK-86)

- **TASK-68: `zond run --safe` (no path) no longer crashes with `paths[0] must be of type string, got boolean`.**
  Commander's auto-negation `--no-db` defaulted `opts.db` to `true`; the boolean leaked into `path.resolve()` via a lazy
  cast. dbPath is now normalised the same way as elsewhere; the no-path / no-`.zond-current` error is explicit and
  mentions both `zond use <api>` and `--api`.

- **TASK-69: `zond db diagnose` no longer hides 5xx failures behind cluster summaries.**
  `groupFailures` previously kept only the first item per group plus 2 examples — for `assertion_failed` clusters that's
  fine, but for `api_error` (5xx) it silently dropped backend-bug evidence. 5xx groups are now always preserved in full
  in `data.failures` and `examples`; assertion/network groups continue to fold.

- **TASK-71: YAML parse errors now report `file:line:col` plus a snippet with a column pointer.**
  `Bun.YAML.parse` exposes JS-stack coordinates, not YAML positions — on failure we re-parse with `yaml` (eemeli) just
  for diagnostics and surface `linePos` in the error. Pre-checks for embedded NUL bytes and points at the
  `{{$nullByte}}` generator. Adds `yaml@2.8.3` dependency.

- **TASK-77: suite-level `parameterize: { key: [val, …] }` cross-product.**
  Replaces copy-pasting one test across N endpoints. Multiple keys produce the cross-product. Captures and
  tainted/missing-capture state are reset between iterations so values from one binding never leak into the next; step
  names are interpolated through `{{var}}` so reporters and `db diagnose` can tell iterations apart.

- **TASK-79: `probe-validation` now pairs every mutating probe with a cleanup-DELETE.**
  When a probe accidentally returns 2xx (the bug class probe-validation hunts for), the new follow-up `DELETE` step
  (`always: true`) consumes a `leaked_id_<i>` capture and removes the resource. When the probe correctly gets 4xx, no id
  is captured and the cleanup is skipped automatically. If the spec defines no DELETE counterpart, the generator emits a
  warning instead. New `--no-cleanup` flag opts out for namespace-isolated test envs.

- **TASK-81: `--rate-limit auto` reads `RateLimit-*` response headers and adapts.**
  Implements RFC `draft-ietf-httpapi-ratelimit-headers` plus the GitHub/Stripe `X-RateLimit-*` aliases. When `remaining`
  drops to ≤5, subsequent requests pause until reset (relative-seconds vs Unix-timestamp distinguished by magnitude).
  Static `--rate-limit N` benefits from the same hook — the cap is a floor, headers can push pauses out further.

- **TASK-86: `zond generate` honours `format` even when `type` is absent or array (OpenAPI 3.1 nullable).**
  `format: email` on a schema with no `type` (or `type: ["string", "null"]`) used to fall through to the default branch
  and produce `{{$randomString}}`. Format-to-placeholder mapping is now dispatched before the type switch.

### Breaking changes

- **MCP layer removed** (see [decision-2](backlog/decisions/decision-2%20-%20Drop-MCP-server-—-keep-CLI-agent-skills-as-the-only-integration-surface.md)) —
  CLI is the only integration surface; agent skills in `skills/*/SKILL.md`
  are read directly. Specifically:
  - `zond mcp start` removed.
  - `zond install --claude/--cursor` removed (was only used to write
    `~/.claude/mcp.json` / `~/.cursor/mcp.json` for the MCP transport).
  - `--integration mcp` flag of `zond init` removed; default integration
    is now `cli` (writes a self-contained `AGENTS.md` with full workflow
    inline). `--integration skip` still works.
  - `@modelcontextprotocol/sdk` runtime dependency dropped.
  - `src/mcp/` deleted entirely (~817 LOC).
  - `src/cli/commands/install.ts` and `src/cli/commands/mcp.ts` deleted.
  - `tests/integration/mcp*.test.ts` removed.
  - All MCP references purged from README, ZOND.md, docs/, skills/,
    AGENTS.md, CLAUDE.md.
  - Migration: existing `~/.claude/mcp.json` / `~/.cursor/mcp.json` keep
    referencing a `zond` server that no longer responds; remove the
    `zond` entry from your client config. New flow — see updated
    `AGENTS.md`: agents call `zond` commands directly.

- **`zond migrate` removed** — the migration system was added and then removed in the same branch.
  Format changes in zond are backward-compatible or require a clean `zond generate`.

---

### Features

#### Generator

- **Sanity suite** (`sanity.yaml`) — `zond generate` now produces a 1-2 step sanity file as the
  first output: an auth step (if the API has auth) + a connectivity probe (healthcheck or first
  simple GET). Run with `--tag sanity` before the full suite to catch `base_url`/auth issues early.
  Skill workflow updated with mandatory Step 3.25.

- **Multipart bodies** — endpoints with `requestBody: multipart/form-data` now generate `multipart:`
  blocks instead of empty `json:`. Binary (`format: binary` / `format: byte`) fields become
  `{ file: ./fixtures/<field>.bin, content_type: application/octet-stream }`.

- **Reset endpoint isolation** — `reset`, `flush`, `purge`, `truncate`, `wipe`, `clear-data`,
  `factory-reset` paths now get tags `[system, reset]` instead of `[smoke, unsafe]`, preventing
  them from running during smoke passes and accidentally wiping server state.

- **Logout exclusion from setup suites** — `logout`, `signout`, `invalidate`, `revoke` endpoints
  are no longer included in `setup: true` auth suites. Including them would invalidate the captured
  token for all subsequent suites.

- **Seed values in smoke path params** — GET smoke steps with path parameters now use concrete seed
  values (from spec `example` field, or `1` for id-like params) instead of unresolved `{{id}}`
  placeholders that cause failures at runtime.

- **Bounded integer generation** — `integer` fields with a `maximum` constraint now generate a
  concrete in-range value instead of `{{$randomInt}}`, which could exceed server-side validation
  limits.

- **ETag auto-injection** — when an endpoint has `412` in its responses or an `If-Match` header
  parameter, the CRUD generator automatically inserts a GET capture step before PUT/PATCH/DELETE
  to capture the ETag, and adds the `If-Match: "{{resource_etag}}"` header to the mutation step.

#### Executor

- **`set:` on HTTP steps** — `set:` directives on regular HTTP steps are now evaluated before the
  request, pinning generators (e.g., `$uuid`) once so the same value can flow into the request body
  and be reused in subsequent steps.

#### Setup suites

- **Auth token auto-sharing** — `setup: true` flag on a suite causes it to run before all other
  suites (sequentially). Its captured variables (e.g., `auth_token`) are merged into the environment
  of every subsequent suite automatically. Generated auth suites now include `setup: true`.

#### Export

- **`zond export postman`** — converts YAML test suites to Postman Collection v2.1 JSON.
  - Full assertion mapping: `status`, `body`, `headers`, `duration` → `pm.test()`/`pm.expect()`
  - Captures → `pm.environment.set()` for cross-request variable sharing
  - `set:` steps → `pm.environment.set()` pre-request scripts on the next HTTP step
  - `skip_if` → `pm.execution.setNextRequest()` pre-request event
  - Optional `--env` flag exports `.env.yaml` as a Postman Environment JSON
  - `each`, `contains_item`, `set_equals` assertions fully translated
  - `type: integer` → `Number.isInteger()` (not `.be.a('number')`)
  - Setup suites sorted first to mirror zond runner behaviour
  - Newman CLI hints embedded in collection description for non-default configs

#### Sync

- **`zond sync`** — incremental test update command. Compares the current spec against the hash
  stored in `.zond-meta.json`, generates test files only for new endpoints, never overwrites
  existing files. Reports removed endpoints as warnings. Updates `collections.openapi_spec` in
  SQLite automatically.

- **`.zond-meta.json`** — metadata file written by `zond generate` and `zond sync`. Stores
  spec URL, SHA-256 hash, and per-file metadata for drift detection.

#### Diagnostics

- **`recommended_action`** field on every failure in `zond db diagnose --json`:
  `report_backend_bug` / `fix_auth_config` / `fix_test_logic` / `fix_network_config`.

- **`agent_directive`** top-level field — when `api_error` count > 0, tells the agent explicitly
  to stop iterating and report the server bug instead of modifying test expectations.

- **`cascade_skips`** field — groups skipped tests by the missing capture variable, making
  "5 tests skipped because `createCase` step failed" visible instead of a flat skip list.

- **`auth_hint`** — surfaces when ≥30% of tests fail with 401/403, and now mentions
  `setup: true` as the recommended fix.

- **Soft delete hint** — when a GET returns `200` with a `status`/`state`/`deleted` field instead
  of the expected `404` (after a DELETE), the diagnostic now surfaces a "likely soft delete" hint
  with a concrete suggestion to assert the status field value.

- **5xx response highlighting** — console reporter now flags failed steps with HTTP 5xx
  responses with a yellow `[5xx <status>]` tag, and the suite/grand-total lines show a
  separate `<N> 5xx` count. The `--json` envelope adds `http_status` and `is_5xx` per
  failure plus a top-level `summary.fiveXx` count, so probe-validation runs surface
  bug candidates at a glance.

- **`--report-out <file>`** on `zond run` — writes the JSON or JUnit report directly to a
  file (with `mkdir -p`) instead of to stdout, logging `zond: <FORMAT> report written to
  <path>` on stderr. Decouples the report from any wrapper banner that prefixes stdout
  (notably `bun run zond -- run …`), so downstream JSON parsers don't break.

#### Bug-hunting probes

- **`zond probe-validation <spec>`** — generates deterministic negative-input probe
  suites that catch the 5xx-on-bad-input class of bugs (the contract: any malformed
  client input must produce a 4xx, never a 5xx). Per endpoint emits probes for: invalid
  path UUIDs, empty body, missing required fields, type confusion, invalid format
  (`email`/`uri`/`date-time`/`uuid`), boundary strings (empty, 10000-char,
  unicode/emoji/RTL), invalid enum values and array-of-string-enum (catches the
  webhooks-events bug shape). `--max-per-endpoint` caps probe count, `--tag` filters
  endpoints. Generated suites embed suite-level `base_url`/auth and are runnable as-is.

- **`zond probe-methods <spec>`** — HTTP method completeness sweep. For every path,
  emits one probe per `{GET, POST, PUT, PATCH, DELETE}` method that is *not* declared
  in the spec, expecting a 4xx (`401/403/404/405`). Path placeholders are substituted
  with valid-shape sentinels so the request reaches the router. Catches "PUT on a
  POST-only endpoint returns 500" bugs.

- **`probe-validation --list-tags`** — lists all tags from the OpenAPI spec without
  generating anything. `--tag X` is now case-insensitive and trims whitespace; matching
  zero endpoints exits 2 with a clear error and the available-tags list.

#### Runner

- **`zond run --sequential`** — opt-out of parallel suite execution. Forces
  sequential runs of all suites (useful when a setup token must propagate or when
  rate-limits make parallel suites trigger 429s).

- **Auto-load `./.env.yaml`** — `zond run` now also tries `$PWD/.env.yaml` when
  `--env` is not given and neither searchDir nor its parent has one. Logs
  `zond: using ./.env.yaml (cwd fallback)` on stderr. Unblocks running absolute test
  paths from a collection cwd.

#### Reporter / DB

- **Cascade-skip reason inline** — console reporter now prints
  `(skipped: <error>)` instead of just `(skipped)`, surfacing the underlying
  capture/auth failure on the very same line.

- **Run classification** — `zond db runs` now classifies a run with `total > 0`,
  `passed == 0`, and many errors as **FAIL** instead of PASS. Prevents a probe run
  with all 5xx responses from looking green in the runs listing.

---

### Fixes

#### Parser / runtime

- **`expect.headers` now accepts `AssertionRule`** — headers can use `capture:`, `equals:`,
  `type:`, etc. (previously only plain string equality). Enables ETag and other header captures.

- **`filePath` normalized to absolute** — `yaml-parser.ts` now stores absolute paths so
  `multipart: file:` paths resolve correctly regardless of CWD at execution time.

- **`multipart:` bodies now reach the HTTP client** — `formData` field added to `HttpRequest`;
  `http-client.ts` sends `formData` when present (previously only `body` was sent, so multipart
  requests were sent empty).

- **`multipart:` variable substitution** — `substituteStep` now processes `multipart:` field
  values, so `{{variables}}` inside multipart blocks are interpolated correctly.

- **Safe mode preserves auth endpoints** — `execute-run.ts` safe mode now keeps
  `login`/`token`/`oauth` endpoints consistent with `run.ts` behaviour.

#### Generator data quality

- **Nested object serialization** — `serializeValue` in `serializer.ts` now recurses into objects
  instead of calling `String(val)`, fixing `[object Object]` in array item bodies.

- **`format: date`** returns `"2025-01-01"` (date-only), not a full datetime string.

- **`format: uuid`** overrides type — `integer` fields with `format: uuid` now correctly get
  `{{$uuid}}` instead of `{{$randomInt}}`.

#### Skill / documentation

- **SKILL.md NEVER rules** — added explicit stop rules for: in-memory auth tokens, ETag, soft
  delete, rate limits, setup suite design, `--tag` without setup tag.

- **SKILL.md generator smart behaviors** — documents all generator improvements so agents know
  what to expect from generated output.

---

### Removed

- `src/mcp/` and all MCP tooling (~1900 lines deleted)
- `zond mcp` CLI command
- `@modelcontextprotocol/sdk` dependency
- `zond migrate` command and `src/core/migrations/` module
- `docs/mcp-guide.md`

---

### Tests

- 502 tests total (499 unit + 3 mocked), 0 failures
- New tests: `suite-generator` — reset tag, smoke seeds, logout filter, ETag injection, multipart
- New tests: `data-factory` — maximum constraint, `generateMultipartFromSchema`
- New tests: `serializer` — nested object serialization, `setup: true`
- New tests: `failure-hints` — soft delete hint, `recommended_action`, `classifyFailure`
- New tests: `executor` — header capture, `set:` pinning, setup capture propagation
- New tests: `schema` — `setup: true` round-trip
- Fixed: `mock.module()` cache pollution — coverage tests moved to `tests/mocked/coverage.ts`
  and run in a separate subprocess via `scripts/run-mocked-tests.ts` (bun#7823, bun#12823)
- Fixed: `test:unit` script — added `tests/diagnostics/`, corrected `tests/web/` and
  `tests/reporter/` paths
