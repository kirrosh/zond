---
name: zond-seed
description: |
  Agent-orchestrated auto-seed: create the fixtures a deep audit needs from
  what the API itself offers, so CRUD depth stops being gated by hand-seeded
  `{{account}}`/`{{customer}}`/… ids. Use when `prepare-fixtures` reports
  `unseededRoots`, when `db diagnose` shows `cascade_skips`, or the user asks
  to "seed fixtures", "create test data", "un-skip the CRUD chains", "raise
  depth". YOU reason (read the API graph, author create-bodies, order them,
  read the 4xx and fix it); zond only EXECUTES (POST + capture id into
  `.env.yaml`). Sibling `zond` runs the full audit; hand back to it once
  fixtures are seeded.
allowed-tools: [Read, Write, Edit, Bash(zond *), Bash(bunx zond *)]
---

# zond-seed — agent-orchestrated fixture creation

The m-24 endgame: an autonomous seed loop where the DECISION is yours and the
EXECUTION is zond's. This is **not** a revert of ARV-336 (the blind recursive
cascade zond removed — 1% success on Stripe). The difference is the feedback
loop: you read the spec + resource graph, author a create-body, POST it, and
when the server says 400 you read *why* and fix the body. That is exactly why
it works where the heuristic engine failed.

## Iron rules (read once, apply always)

- **You reason, zond executes.** You author every create-body and pick the
  order; zond only POSTs and captures the returned id. Never ask zond to
  "figure out" a body — that heuristic engine was deleted (ARV-336, m-24) and
  must not grow back. There is no `zond seed` command by design.
- **No blind cascade — one create at a time, with a feedback loop.** POST a
  body, read the response. On 4xx, read the error message, revise the *specific*
  field it names, retry. Cap at **~3 attempts per resource**, then mark it
  un-seedable and move on. Never fire a chain of creates without reading each
  reply.
- **Seed only what the API can self-serve.** Fixtures needing external input —
  KYC-verified accounts, verified bank accounts, webhook signing secrets,
  paid-plan / SCIM / TOS-gated resources, or ids that only exist after a real
  event (`issue_id`, `file_id`, `integration_id`) — are **reported, not
  invented** (pairs with `prepare-fixtures` `unseededRoots` and ARV-349/350).
  Guessing a value here just 422s and lies about coverage. Hand those to the
  **`warm-up-target`** skill, which warms them via the target's own SDK/CLI.
- **Live + throwaway/sandbox + cleanup only.** Never seed against production or
  shared data. Confirm `base_url` is a sandbox/test account first. Track every
  id you create and DELETE it at the end (or seed inside a disposable account /
  Stripe test-clock). If you cannot guarantee cleanup, ask before creating.
- **Honor prose exclusion.** Specs document mutual exclusion in `description`,
  not machine-readable `oneOf` (Stripe: "You may only specify one of A, B").
  If a 400 says that, drop one member and retry (folded from ARV-347).

## Inputs — what to seed

| Signal | Command | Field |
|---|---|---|
| Chain-heads gating suites | `zond prepare-fixtures --api <name> --json` | `summary.fixtureGaps.unseededRoots[]` |
| Empty captures from last run | `zond db diagnose --json` | `cascade_skips[].capture_var` |
| Dependency order | `apis/<name>/.api-resources.yaml` | each resource's `fkDependencies` |
| Body schema + last server reply | `zond api annotate dump --seed-bodies --with-last-attempt --api <name>` | `seed_body`, `last_attempt` |

`unseededRoots` is your worklist. `fkDependencies` gives the order: a resource
whose FK points at another must be created *after* its parent (parent id is
captured first, then referenced). Sort parent-before-child yourself; skip
cycles and resources whose only dep is external input.

**miss-no-list `candidates` (ARV-382):** when prepare-fixtures can't confidently
derive the owner list for a fixture var, the item carries a `candidates[]` of
plausible GET/list endpoints (ranked by structural proximity; deprecated ones
marked `(deprecated)`). zond does NOT pick — that's your call: `zond request`
the top candidate, read a record, `zond fixtures add <var>=<id>`. An empty
`candidates` (and no owner) is an honest dead-end: no listable source exists —
create the resource or obtain the id from a parent flow.

## The loop

For each root, parent-first:

1. **Author the body.** `zond api annotate dump --seed-bodies --with-last-attempt`
   gives the schema, a rationale, and `last_attempt` (what zond last POSTed and
   how the server replied). Fill required fields with real-looking values;
   reference already-captured parents as `{{parent_var}}`.

2. **Create + capture** — one command, deterministic:
   ```bash
   zond request POST /v1/accounts --api <name> \
     --body '{"type":"custom","country":"US","capabilities":{...}}' \
     --json-path id --capture account
   ```
   On 2xx zond writes `account=<id>` into `apis/<name>/.env.yaml` (with a
   `.bak` backup) and prints `captured account=<id>`. On non-2xx it writes
   nothing and prints `--capture account skipped — … status=400 …`.

3. **Feedback on failure.** Read the response body. Common fixes:
   - "Missing required field X" → add X.
   - "You may only specify one of A, B" → drop one (prose exclusion).
   - "Invalid <field>" / 422 on an id → the value is external-input; stop
     retrying this root and mark it un-seedable.
   Revise the `--body`, retry. Cap ~3 attempts.

4. **Cascade.** Once a parent id is captured, its children unblock — their
   `{{parent_var}}` now resolves. Walk down the dependency chain.

5. **Verify.** Re-run `zond prepare-fixtures --api <name> --json` — the roots
   you seeded should drop out of `unseededRoots`.

## Cleanup & report

- DELETE every id you created (reverse order — children first), or confirm the
  seed account is disposable.
- Report: **seeded** (var → id), **un-seedable** (var → reason: external input
  / gated / no create endpoint). The un-seedable list is the honest ceiling —
  hand it to the user; do not paper over it with invented values.

Hand back to `zond` for the full audit once depth is unblocked. Measure the
lift: test coverage before vs after seeding.
