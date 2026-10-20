# Architecture (C4)

zond's architecture in the [C4 model](https://c4model.com): L1 Context → L2 Containers → L3 Components.
L4 (code) is the source itself — start at [`src/CLAUDE.md`](../src/CLAUDE.md).

Core principle ([decision-9](../backlog/decisions/decision-9%20-%20phase-transition-lighten-zond-agent-owns-judgment.md)):
**zond is a deterministic tool, the agent owns judgment.** zond sends requests, validates
schemas and emits evidence with closed-enum hints; severity, false-positive triage and
blame attribution stay with the agent. zond never calls an LLM.

## L1 — System Context

```mermaid
C4Context
  title zond — System Context

  Person(dev, "Developer", "Small team member who owns or consumes a REST API")
  System_Ext(agent, "Coding agent", "Claude Code / Cursor / Codex. Reads skills + AGENTS.md, drives the CLI, makes all judgment calls")

  System(zond, "zond", "API hygiene scanner: tests REST endpoints against the OpenAPI spec, catches contract drift, tracks coverage")

  System_Ext(api, "Target REST API", "GitHub, Stripe, Vercel, an internal service… Safe (GET-only) by default, --live only on sandboxes")
  System_Ext(spec, "OpenAPI spec", "Local file or URL — the source of truth for API shape")
  System_Ext(ci, "CI / GitHub Code Scanning", "Consumes JUnit, SARIF v2.1.0, exit codes")

  Rel(dev, agent, "Asks: test my API")
  Rel(dev, zond, "Runs directly", "CLI")
  Rel(agent, zond, "Runs commands, reads JSON/NDJSON", "CLI")
  Rel(zond, spec, "Reads, dereferences")
  Rel(zond, api, "Sends probes and tests", "HTTPS")
  Rel(zond, ci, "Reports", "SARIF / JUnit")

  UpdateRelStyle(zond, api, $offsetY="-25")
  UpdateLayoutConfig($c4ShapeInRow="3")
```

## L2 — Containers

zond ships as one self-contained binary (Bun-compiled); everything else is plain files
in the workspace. No daemon, no server, no transport layer.

```mermaid
C4Container
  title zond — Containers

  System_Ext(agent, "Coding agent", "Claude Code / Cursor / Codex")
  System_Ext(api, "Target REST API", "HTTPS")

  System_Boundary(z, "zond") {
    Container(skills, "Agent skills", "Markdown (SKILL.md)", "zond, zond-checks, zond-seed, zond-triage, warm-up-target. Shipped via plugin / skills.sh / zond init")
    Container(cli, "zond CLI", "TypeScript, single Bun binary", "Spec parsing, test generation, runner, probes, depth checks, reporters")
    ContainerDb(ws, "API workspace", "YAML/JSON files, apis/{name}/", "spec.json, .api-catalog.yaml, .api-resources.yaml, .api-fixtures.yaml (manifest), .env.yaml (values)")
    ContainerDb(db, "Run history", "SQLite, .zond/zond.db", "Runs, results, check findings — diffs, coverage, regressions")
    Container(reports, "Reports", "HTML / SARIF / JUnit / NDJSON", "Audit report, scorecard, Code Scanning upload")
  }

  Rel(agent, skills, "Loads on intent")
  Rel(agent, cli, "Executes", "shell")
  Rel(cli, ws, "Reads/writes")
  Rel(cli, db, "Persists runs")
  Rel(cli, reports, "Emits")
  Rel(cli, api, "HTTP requests", "HTTPS")
```

Removed on purpose: the **MCP server**. Every successful agent session used the CLI, so MCP
was dropped and stays dropped ([decision-2](../backlog/decisions/decision-2%20-%20Drop-MCP-server-—-keep-CLI-agent-skills-as-the-only-integration-surface.md),
reconfirmed in [decision-10](../backlog/decisions/decision-10%20-%20Подтверждение-decision-2-MCP-обёртку-не-возвращаем-даже-как-discovery-канал.md)).

## L3 — Components of the zond CLI

```mermaid
flowchart TB
  classDef comp fill:#85bbf0,stroke:#5d82a8,color:#000
  classDef db fill:#438dd5,stroke:#2e6295,color:#fff
  classDef ext fill:#999,stroke:#6b6b6b,color:#fff

  cmd["<b>Commands</b><br/><i>src/cli/commands</i><br/>Parse flags, call core.<br/>No business logic"]:::comp

  subgraph core ["zond CLI · core"]
    parser["<b>Spec & generator</b><br/><i>core/spec, core/generator</i><br/>OpenAPI → catalog, resources,<br/>fixtures manifest, YAML suites"]:::comp
    runner["<b>Runner</b><br/><i>core/runner</i><br/>HTTP client, variables, assertions,<br/>schema validation, worker pool"]:::comp
    probes["<b>Probes & depth checks</b><br/><i>core/probe, core/checks</i><br/>Negative input, auth, mass-assignment,<br/>use-after-free, stateful invariants"]:::comp
    diag["<b>Diagnostics</b><br/><i>core/diagnostics, core/audit</i><br/>Failure classes, coverage,<br/>audit pipeline, scorecard"]:::comp
    rep["<b>Reporters</b><br/><i>core/reporter, core/exporter</i><br/>Console, JSON, NDJSON,<br/>JUnit, SARIF, HTML"]:::comp
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
