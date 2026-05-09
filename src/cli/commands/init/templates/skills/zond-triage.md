---
name: zond-triage
description: |
  Last-run triage. Use when the user asks "что упало в последнем run", "почему
  красное", "что с ralph-loop'ом сделать", "summary последнего прогона",
  "explain failures", "что мне сейчас править". Reads `recommended_action`
  enum from `zond db diagnose`, `zond check spec`, and `zond probe-*` JSON
  artifacts and emits an actionable summary grouped by next-step. No LLM
  classification — every line is routed by the enum value emitted by zond.
allowed-tools: [Read, Bash(zond *), Bash(bunx zond *), Bash(jq *)]
---

# zond-triage — last-run summary

Narrow skill: the user already has a finished run (or a recent
`probe-*` / `check spec` artifact) and wants to know **what failed and
what to do next**. Sibling `zond` does the full audit; sibling
`zond-scenarios` writes new flows. This one only reads.

## Iron rules

- **Route on `recommended_action`, not on the message string.** Every zond
  artifact stamps a closed enum: `report_backend_bug | fix_test_logic |
  fix_auth_config | fix_network_config | fix_env | fix_spec |
  fix_fixture`. Group by enum, then summarise. Never re-classify with
  prose heuristics.
- **One actionable line per group.** The agent-directive *is* the next
  command — don't pad with "consider checking...".
- **`report_backend_bug` / 5xx → STOP, surface, do not edit `expect:`.**
  Same iron rule as the parent `zond` skill.
- **`fix_env` overrides `fix_test_logic` at the suite level.** `db
  diagnose` already does this collapse (TASK-70/98) — trust the field
  it returns, don't merge again client-side.
- **Never read raw response bodies past 8 KB.** The diagnose envelope
  truncates by default; pass `--no-body-cap` only if the user is
  triaging body-shape bugs.
- **Никогда не выдавать абстрактные «проверьте логи» / «уточните у
  команды».** Если в enum-группе нет конкретного действия — пометить
  `<TODO: clarify>` и выйти, не маскировать пустоту.

## Sources & enum routing

| Source | How to read | Emits `recommended_action` for |
|---|---|---|
| `zond db diagnose <run-id> --json` | per-failure under `data.failures[]` | every fail/error in the run |
| `zond check spec --api <name> --json` | `data.issues[]` | every lint Issue (always `fix_spec`) |
| `zond probe mass-assignment --json` | `data.verdicts[]` | per-endpoint verdicts (high/medium/inconclusive-5xx/inconclusive-baseline) |
| `zond probe security --json` | counts only — read the markdown digest | high / low findings (markdown table) |
| `zond probe static --json` | `data.files[]` (suite YAMLs to run) | findings surface only after `zond run` → routed via diagnose |

`probe-security` does not expose findings in `--json`; treat its
markdown digest as the canonical source for that class and parse
HIGH/LOW rows by hand.

## Phase 1 — locate the run

If the user did not name a run id, the default of `zond db diagnose`
already targets the most recent failing run (TASK-266). Skip straight to
Phase 2 unless you specifically need an older run:

```bash
zond db runs --limit 5 --json   # pick a non-default run id
```

If `trigger=ci`, mention the CI build in the summary. If the user said
"после моего фикса", take the second-most-recent and pair with
`zond db compare <prev> <curr> --json` for a regression diff.

## Phase 2 — pull the diagnose envelope

```bash
zond db diagnose --json              # last failing run (default — TASK-266)
zond db diagnose <run-id> --json     # explicit run
zond db diagnose --latest --json     # last run, even if it passed
```

The shape (relevant fields only):

```jsonc
{
  "ok": true,
  "data": {
    "run_id": 42,
    "summary": { "passed": 18, "failed": 7, "errored": 1 },
    "env_issue": { "scope": "suite", "affected_suites": [...], "message": "..." },
    "failures": [
      {
        "suite_name": "crud-projects",
        "test_name": "create project",
        "failure_type": "api_error",
        "recommended_action": "report_backend_bug",
        "request_method": "POST",
        "request_url": "...",
        "response_status": 500,
        "hint": "...",
        "schema_hint": "..."
      }
    ]
  }
}
```

Bucket every failure by `recommended_action`. Display order (highest
priority first):

1. `report_backend_bug` — 5xx / schema_violation / mass-assignment HIGH.
   Bug. Surface excerpt; offer `zond report bundle --include case-study`.
2. `fix_spec` — emitted only by `zond check spec`. Edit OpenAPI source,
   then `zond refresh-api <name>`.
3. `fix_auth_config` — 401/403 cluster. Check `auth_token` scope (or run
   `zond doctor --api <name> --missing-only`).
4. `fix_env` — env_issue cluster. Print `env_issue.message` verbatim;
   point at `.env.yaml` (path is in the envelope).
5. `fix_fixture` — discover miss-* / inconclusive-baseline. Run
   `zond prepare-fixtures --api <name> --apply [--cascade [--seed]]`.
6. `fix_network_config` — connect-refused / DNS / TLS. Check `base_url`
   reachability; `--proxy` may be needed.
7. `fix_test_logic` — 4xx (400/422) on stub-generated body. Phase 4a of
   the `zond` skill: fixture pack first, typed generator second, literal
   third.

Within each bucket, collapse by `(suite_name, response_status,
request_method, root_cause)` and report a count + 1-2 examples. Do
**not** dump every failure.

## Phase 3 — reconcile spec / probe sources

Run only what the user's question implies — don't fan out blindly.

```bash
# spec-level lint (only if user asked about spec drift / contract)
zond check spec --api <name> --json | jq '.data.issues | group_by(.rule)'

# mass-assignment digest (only if user mentioned mass-assign / privilege)
zond probe mass-assignment --api <name> --json
# verdicts with recommended_action != null are the actionable subset
```

For `probe-security`, the digest is the source. Read the file the user
named (or `apis/<name>/probes/security-digest.md`) and pull HIGH rows
plus the `## ⚠️ Cleanup failures` section if present.

## Output template

Stay terse. Russian by default, mirror the user's language.

```
Run #<id> · <ts> · session=<id?> · trigger=<ci|manual>
Pass <N>  Fail <M>  Error <K>  Coverage <pct>%

⛔ report_backend_bug  ×<n>
  · POST /v1/projects → 500 (×3) — TypeError: cannot read 'slug'
    next: zond report bundle <id> --include case-study
🛠  fix_test_logic  ×<n>
  · POST /v1/audiences → 422 expected uuid (×2)
    next: replace {{$randomString}} with {{$uuid}} in audiences.yaml
🔑 fix_auth_config  ×<n>
  · 4 suites all 401 — check auth_token scope
    next: zond doctor --api <name> --missing-only
🌐 fix_env  ×<n>
  · base_url unset (env_issue.scope=run)
    next: edit apis/<name>/.env.yaml → base_url
📥 fix_fixture  ×<n>
  · {{audience_id}} unresolved
    next: zond prepare-fixtures --api <name> --apply --cascade
📜 fix_spec  ×<n>  (from check spec)
  · A2 missing operationId on POST /webhooks
    next: edit spec.json → operationId, then zond refresh-api <name>
```

Skip empty buckets. If `summary.failed + summary.errored == 0`, just
say "all green" and exit — don't invent work.

## When to escalate

- **Mixed recommended_action inside one suite (>3 distinct enums):**
  the run was probably aborted mid-setup. Check `env_issue` first; if
  not set, the run hit a fatal early failure — `zond db run <id>
  --status 500 --first-only --json` to find it.
- **Cleanup failures from `probe-security`:** call out at the **top** —
  this means probe mutated state it could not restore. Treat as
  blocking; do not run more probes against the same env until the
  user confirms manual cleanup.
- **`recommended_action` missing on a verdict you expected to see:**
  TASK-294 stamps it on every issue/finding emitted post-Done. If a
  field is missing, you're probably reading a pre-TASK-294 artifact —
  re-run the source command, don't infer.

## Hand-off back to `zond`

When the user wants to *act* on the summary (write a fix, file a
report, re-run the suite), hand off to the parent `zond` skill — it
owns the YAML edits, `zond report bundle` flow, and the re-run loop.
This skill stops at the summary.
