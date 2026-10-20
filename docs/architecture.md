# Architecture (C4)

zond's architecture in the [C4 model](https://c4model.com): L1 Context → L2 Containers → L3 Components.
L4 (code) is the source itself — start at [`src/CLAUDE.md`](../src/CLAUDE.md).

Core principle ([decision-9](../backlog/decisions/decision-9%20-%20phase-transition-lighten-zond-agent-owns-judgment.md)):
**zond is a deterministic tool, the agent owns judgment.** zond sends requests, validates
schemas and emits evidence with closed-enum hints; severity, false-positive triage and
blame attribution stay with the agent. zond never calls an LLM.

## L1 — System Context

```mermaid
flowchart TB
  classDef person fill:#08427b,stroke:#052e56,color:#fff
  classDef sys fill:#1168bd,stroke:#0b4884,color:#fff
  classDef cont fill:#438dd5,stroke:#2e6295,color:#fff
  classDef ext fill:#999,stroke:#6b6b6b,color:#fff
  classDef removed fill:#f4f4f4,stroke:#999,stroke-dasharray:5 5,color:#777

  dev["<b>Developer</b><br/><i>[Person]</i><br/>Small team member who owns or consumes a REST API"]:::person
  agent["<b>Coding agent</b><br/><i>[Software System: Claude Code / Cursor / Codex]</i><br/>Reads skills + AGENTS.md, drives the CLI, makes all judgment calls"]:::ext

  zond["<b>zond</b><br/><i>[Software System]</i><br/>API hygiene scanner: tests REST endpoints against the OpenAPI spec, catches contract drift, tracks coverage"]:::sys

  spec["<b>OpenAPI spec</b><br/><i>[Software System]</i><br/>Local file or URL — source of truth for API shape"]:::ext
  api["<b>Target REST API</b><br/><i>[Software System]</i><br/>GitHub, Stripe, Vercel, internal services. GET-only by default, --live on sandboxes"]:::ext
  ci["<b>CI / GitHub Code Scanning</b><br/><i>[Software System]</i><br/>Consumes JUnit, SARIF v2.1.0, exit codes"]:::ext

  dev -->|asks: test my API| agent
  dev -->|runs directly<br/><i>CLI</i>| zond
  agent -->|runs commands, reads JSON/NDJSON<br/><i>CLI</i>| zond
  zond -->|reads, dereferences| spec
  zond -->|sends probes and tests<br/><i>HTTPS</i>| api
  zond -->|reports<br/><i>SARIF / JUnit</i>| ci
```

## L2 — Containers

zond ships as one self-contained binary (Bun-compiled); everything else is plain files
in the workspace. No daemon, no server, no transport layer.

```mermaid
flowchart TB
  classDef person fill:#08427b,stroke:#052e56,color:#fff
  classDef sys fill:#1168bd,stroke:#0b4884,color:#fff
  classDef cont fill:#438dd5,stroke:#2e6295,color:#fff
  classDef ext fill:#999,stroke:#6b6b6b,color:#fff
  classDef removed fill:#f4f4f4,stroke:#999,stroke-dasharray:5 5,color:#777

  agent["<b>Coding agent</b><br/><i>[Software System: Claude Code / Cursor / Codex]</i>"]:::ext

  subgraph zond ["zond [Software System]"]
    skills["<b>Agent skills</b><br/><i>[Container: Markdown SKILL.md]</i><br/>zond, zond-checks, zond-seed, zond-triage, warm-up-target. Shipped via plugin / skills.sh"]:::cont
    cli["<b>zond CLI</b><br/><i>[Container: TypeScript, single Bun binary]</i><br/>Spec parsing, test generation, runner, probes, depth checks, reporters"]:::cont
    mcp["<b>MCP server</b><br/><i>[removed — ADR decision-2]</i><br/>Every successful agent session used the CLI instead"]:::removed
    ws[("<b>API workspace</b><br/><i>[Container: YAML/JSON, apis/{name}/]</i><br/>spec.json, catalog, resources, fixtures manifest, .env.yaml values")]:::cont
    db[("<b>Run history</b><br/><i>[Container: SQLite, .zond/zond.db]</i><br/>Runs, results, check findings")]:::cont
    reports["<b>Reports</b><br/><i>[Container: HTML / SARIF / JUnit / NDJSON]</i><br/>Audit report, scorecard, Code Scanning upload"]:::cont
  end

  api["<b>Target REST API</b><br/><i>[Software System]</i>"]:::ext

  agent -->|loads on intent| skills
  agent -->|executes<br/><i>shell</i>| cli
  agent -.-x|dropped| mcp
  cli -->|reads / writes| ws
  cli -->|persists runs| db
  cli -->|emits| reports
  cli -->|HTTP requests<br/><i>HTTPS</i>| api
```

The dashed **MCP server** was removed on purpose: every successful agent session used the CLI, so MCP
was dropped and stays dropped ([decision-2](../backlog/decisions/decision-2%20-%20Drop-MCP-server-—-keep-CLI-agent-skills-as-the-only-integration-surface.md),
reconfirmed in [decision-10](../backlog/decisions/decision-10%20-%20Подтверждение-decision-2-MCP-обёртку-не-возвращаем-даже-как-discovery-канал.md)).

## L3 — Components of the zond CLI

```mermaid
flowchart TB
  classDef comp fill:#85bbf0,stroke:#5d82a8,color:#000
  classDef db fill:#438dd5,stroke:#2e6295,color:#fff
  classDef ext fill:#999,stroke:#6b6b6b,color:#fff

  cmd["<b>Commands</b><br/><i>src/cli/commands</i><br/>Parse flags, call core. No business logic"]:::comp

  subgraph core ["zond CLI · core"]
    parser["<b>Spec & generator</b><br/><i>core/spec, core/generator</i><br/>OpenAPI → catalog, resources, fixtures manifest, YAML suites"]:::comp
    runner["<b>Runner</b><br/><i>core/runner</i><br/>HTTP client, variables, assertions, schema validation, worker pool"]:::comp
    probes["<b>Probes & depth checks</b><br/><i>core/probe, core/checks</i><br/>Negative input, auth, mass-assignment, use-after-free, stateful invariants"]:::comp
    diag["<b>Diagnostics</b><br/><i>core/diagnostics, core/audit</i><br/>Failure classes, coverage, audit pipeline, scorecard"]:::comp
    rep["<b>Reporters</b><br/><i>core/reporter, core/exporter</i><br/>Console, JSON, NDJSON, JUnit, SARIF, HTML"]:::comp
  end

  ws[("<b>API workspace</b><br/>apis/{name}/")]:::db
  db[("<b>Run history</b><br/>SQLite")]:::db
  api["<b>Target REST API</b>"]:::ext

  cmd -->|add api / generate| parser
  cmd -->|run / audit| runner
  cmd -->|probe / checks run| probes
  cmd -->|coverage / db diagnose| diag
  cmd -->|formats output| rep
  parser -->|writes artifacts| ws
  runner -->|reads suites, fixtures| ws
  runner -->|HTTPS| api
  probes -->|HTTPS| api
  runner -->|results| db
  probes -->|findings + recommended_action| db
  diag -->|reads history| db
```
