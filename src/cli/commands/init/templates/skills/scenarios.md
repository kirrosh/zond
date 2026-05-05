---
name: zond-scenarios
description: |
  Default skill after `zond init`. Triggers when the user asks to verify a
  specific user flow or business scenario via the API — "write a test for
  X", "check that after Y the user gets Z", "replay this UI flow", "smoke
  this checkout end-to-end", "create test data for ...". Use when there is
  a concrete task to verify, not a full audit / coverage / bug-hunt — for
  those, hand off to the `zond` skill.
allowed-tools: [Read, Write, Edit, Bash(zond *), Bash(bunx zond *), Bash(sqlite3 *)]
---

# zond — Scenario authoring

You write **hand-crafted multi-step YAML** that exercises a specific flow,
runs it, and analyses the result. No autogen, no full audit. Optimised
for small focused work — bug repro, post-deploy smoke for one flow,
verifying a fix.

## Iron rules

1. **Never read raw OpenAPI spec.** All endpoint info lives in the
   workspace artifacts. Reading `apis/<name>/spec.json` is allowed only
   when the user explicitly asks (e.g. probe authoring) — not for
   navigation.
2. **Never invent endpoints.** Only use entries present in
   `apis/<name>/.api-catalog.yaml`.
3. **Never edit `.api-*.yaml` artifacts by hand.** They are regenerated
   by `zond refresh-api`.
4. **Never autogenerate scenarios** with `zond generate` (that emits
   per-endpoint smoke suites, not user flows).
5. **Run `zond doctor --api <name>` before authoring.** If required
   fixtures are missing, ask the user to fill `.env.yaml` first — don't
   plough on with broken fixtures.

## Phase 0 — orient

```bash
zond doctor --api <name> --json     # fixture gaps + artifact freshness
```

Read these three files (not the raw spec):

- `apis/<name>/.api-catalog.yaml` — endpoint shape (method, path, params, request/response schemas in compressed form).
- `apis/<name>/.api-resources.yaml` — CRUD chains with captureField, idParam, FK dependencies (`fkDependencies` array tells you which other resources you must create first).
- `apis/<name>/.api-fixtures.yaml` — required `{{vars}}` and what they're for.

If `zond doctor` reports stale artifacts, run `zond refresh-api <name>`
before continuing.

## Phase 1 — clarify the scenario (one round, max)

Confirm with the user, in one short message:

- Which flow, in plain English (e.g. "after creating a contact in audience X, deleting that audience should not orphan the contact").
- Which API endpoints you intend to chain, taken from `.api-catalog.yaml` — list them.
- Which fixtures you'll need from `.env.yaml`.

Don't ask if the user already gave you enough. Jump to Phase 2.

## Phase 2 — author the scenario file

Write `apis/<name>/scenarios/<flow-slug>.yaml` directly with your `Write`
tool. There is **no scaffold command** — the structure varies per flow,
so freeform authoring is faster than templating.

**Use this exact YAML grammar** (zond's runner format — *not* the
Postman / OpenAPI request/body shape):

```yaml
name: cancel-pending-order
tags: [scenario, orders, cancel-flow]
base_url: "{{base_url}}"
headers:
  Authorization: "Bearer {{auth_token}}"

# Optional — make captures from this file visible to other suites in the
# same run (e.g. for shared setup). Leave unset for normal scenarios.
# setup: true

tests:
  # Step 1 — setup: read a precondition we depend on
  - name: pre-check workspace exists
    GET: /workspaces/{{workspace_id}}
    expect:
      status: 200
      body:
        id: { capture: ws_id }    # capture into ws_id for later steps

  # Step 2 — main action
  - name: create order
    POST: /workspaces/{{ws_id}}/orders
    json:
      amount: 100
      currency: USD
    expect:
      status: 201
      body:
        id: { capture: order_id }
        status:
          equals: pending

  # Step 3 — cancel it
  - name: cancel order
    POST: /orders/{{order_id}}/cancel
    expect:
      status: 200

  # Step 4 — verify postcondition
  - name: order is cancelled
    GET: /orders/{{order_id}}
    expect:
      status: 200
      body:
        status:
          equals: cancelled

  # Step 5 — cleanup, runs even if earlier steps failed
  - name: delete order
    DELETE: /orders/{{order_id}}
    always: true
    expect:
      status: [200, 204, 404]
```

### Grammar cheatsheet

- HTTP verb is a **top-level key** on the step: `GET: /path`, `POST: /path`, `PUT`, `PATCH`, `DELETE`.
- Body goes in `json: {...}` (or `form:`, `multipart:`, `text:` — see ZOND.md).
- Captures: `expect.body.<field>: { capture: <var_name> }` — extracts that field from the JSON response into a variable usable by later steps in the same suite.
- Assertions on the body: `equals`, `exists`, `matches`, `gt`/`lt`, `oneOf`, etc. (see ZOND.md "Assertions").
- `always: true` — step runs even if a prior step failed (use for cleanup so test data doesn't leak).
- `skip_if: "{{var}} =="` — skip when a fixture var is unset.
- Per-step `headers:` override the suite-level `headers:`.
- For values you want randomised, use generators: `{{$randomEmail}}`, `{{$uuid}}`, `{{$randomString(20)}}`, `{{$randomInt(1,1000)}}`. Full list in `zond run --help`.

### Multi-service flows

If the scenario crosses services, declare each base URL in `.env.yaml`:

```yaml
# apis/<name>/.env.yaml
base_url: https://api.users.example.com   # default for unprefixed paths
billing_url: https://api.billing.example.com
```

…then reference per-step:

```yaml
- name: charge
  POST: "{{billing_url}}/charges"
  json: { amount: 100 }
```

(Native per-step `base_url:` override is on the roadmap — for now use
explicit `{{...}}`.)

## Phase 3 — run

Group multi-step / multi-run work under one session so the dashboard
shows a single row in `/runs`:

```bash
zond session start --label "<short reason>"
zond run apis/<name>/scenarios/<flow>.yaml --json
zond session end
```

**Pass `--json`** so you can parse the result. Look at:

- `summary.passed / failed / skipped` — top-level outcome.
- For each step: `status`, `assertions[]` (which checks failed), `captures` (what was extracted), `request` and `response` (full evidence).

## Phase 4 — diagnose failures

```bash
zond db diagnose <run-id> --json
```

Each entry has:

- `failure_class`: `definitely_bug` | `likely_bug` | `quirk` | `env_issue` | `cascade`.
- `agent_directive`: literal next step.
- `recommended_action`: `report_backend_bug` (STOP, summarise for the
  user) | `fix_test_logic` (edit the YAML) | `update_expectation` (only
  with the user's explicit OK).

`cascade` failures collapse under their root cause — don't chase them
individually, fix the upstream step.

If a 422/400 is caused by a stub/random value, swap to a typed
generator (`{{$randomEmail}}`, `{{$uuid}}`) or hardcode a literal that
satisfies the contract. If it's caused by a missing FK, add the var to
`.env.yaml` and re-run `zond doctor`.

## Phase 5 — finish

- Show the user the captured values from successful steps (they often
  want to see "the order_id we got was X").
- For a failed scenario, summarise the failure class + reason in 1-2
  lines and ask what they want — fix YAML, report bug, dig deeper.
- If the scenario is something they'll re-run regularly, suggest
  `/schedule` or a CI workflow (`zond ci init`).

## When to hand off

Step out of `scenarios` and load the `zond` skill when:

- User asks for a **full audit** / coverage report / probe sweep / spec
  drift check.
- User wants to register a new API or refresh artifacts (use
  `zond add api` / `zond refresh-api` directly — these are not
  scenario-skill jobs but they are dashed off in seconds).
- The current scenario surfaced a contract bug worth a structured report
  (`zond report case-study <failure-id>` produces a markdown draft).
