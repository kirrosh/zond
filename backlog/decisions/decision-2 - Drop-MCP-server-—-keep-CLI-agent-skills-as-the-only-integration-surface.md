---
id: decision-2
title: Drop MCP server — keep CLI + agent skills as the only integration surface
date: '2026-04-28 10:34'
status: accepted
---

## Context

zond shipped two AI-agent integration surfaces in parallel:
1. **CLI** — `zond run`, `zond probe-validation`, `zond db diagnose`, etc. — usable
   from any terminal, any agent stack (Claude Code, Codex, Cursor, plain bash),
   discoverable via `--help` and `AGENTS.md`.
2. **MCP server** — `zond mcp start` exposing tools (`zond.run`, `zond.diagnose`,
   `zond.coverage`, …) and resources (`workflow://`, `rules://`, …) over stdio
   for MCP-aware clients.

Empirical signal across multiple live sessions (auto-loop iter-2..iter-4, manual
Resend-tests sessions, sequential-dev runs):
- **Every successful agent run used the CLI**, not MCP. APPLY agents invoked
  `bun run zond -- probe-validation`, `zond run`, `zond db diagnose`. DEV agents
  invoked `bunx backlog task list/edit/create`. The cron auto-loop never once
  needed MCP.
- The only MCP path actually exercised was the **backlog MCP** (`.mcp.json`),
  which is upstream tooling and not zond's surface.
- TASK-31 (re-running a live MCP session to measure actual usage) was filed in
  m-3 and never got pulled — there was no demand.
- Documentation (TASK-30 — clarify MCP vs CLI vs Skills) kept hitting the same
  shape of question: which one do I use? Maintaining two answers is an
  ongoing cost paid every release for users who only ever want one.

The cost of carrying MCP:
- ~817 LOC in `src/mcp/` (server, tools, resources, registry, content
  embeds).
- `@modelcontextprotocol/sdk` is the heaviest runtime dep we ship.
- Two install paths (`zond install --claude/--cursor` vs CLI-only via skills).
- Two test surfaces (`tests/integration/mcp.test.ts`, `mcp-tools.test.ts`).
- Two flavours of `AGENTS.md` template (`agents-mcp-nudge.md`,
  `agents-cli-full.md`).
- Drift risk: every CLI feature has to decide whether it gets an MCP-tool
  twin (most do not).

## Decision

Drop the MCP server. Keep two surfaces only:
1. **CLI** as the canonical interface. Every supported workflow has a CLI
   command with `--help` and JSON envelope (`--json`).
2. **Agent skills** in `skills/*/SKILL.md` — read directly by skill-aware
   agents (Claude Code, Codex, Hermes), no transport, no daemon, no SDK.

Concretely we will:
- Delete `src/mcp/` and the `@modelcontextprotocol/sdk` dependency.
- Remove `zond mcp start` and `zond install --claude/--cursor` (they exist
  only to install the MCP server config). Replace `install` with a thin
  `zond agents-md` (or extend `zond init`) that just writes `AGENTS.md` /
  `CLAUDE.md` pointers to the CLI and skills.
- Drop the `--integration mcp` flag from `zond init`; default integration
  becomes `cli` (the existing `agents-cli-full.md` template).
- Remove MCP-related sections from `README.md`, `ZOND.md`, `docs/quickstart.md`,
  `docs/INDEX.md`, and the four `skills/*/SKILL.md` files.
- Keep `.mcp.json` at the repo root for **upstream backlog MCP only** (it's
  for project-local backlog ops, not zond's surface). Document that this is
  an external dependency, not a zond integration.

## Consequences

Positive:
- One supported way to call zond from any agent → fewer bug-classes, less
  drift, simpler docs.
- Heaviest runtime dependency removed, smaller binary.
- Test suite shrinks by two integration files; no flaky stdio MCP transport
  to maintain.
- Skill-based agent surface (`skills/api-testing/SKILL.md`,
  `skills/setup/SKILL.md`, etc.) becomes the canonical "how do I use zond
  from an agent?" answer.

Negative / cost to migrate:
- One-time breaking change for any user who configured `zond install --claude`.
  Migration: their `~/.claude/mcp.json` keeps working until they remove it
  manually; `AGENTS.md` already covers the CLI path.
- ~5 backlog tasks (T5–T7 already shipped MCP infrastructure, T20/T30/T31
  pending) become dead ends — close as won't-do.

Open follow-ups:
- TASK-DROP-MCP-1: code & dep removal.
- TASK-DROP-MCP-2: docs purge + AGENTS.md/CLAUDE.md rewrite to CLI-only
  default.
- TASK-DROP-MCP-3: `zond init`/`zond install` cleanup (remove MCP integration
  mode and install command).
- TASK-DROP-MCP-4: test cleanup + CHANGELOG entry.
