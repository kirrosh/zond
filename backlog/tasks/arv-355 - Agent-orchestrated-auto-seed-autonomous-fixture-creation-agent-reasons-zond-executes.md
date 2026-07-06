---
id: ARV-355
title: >-
  Agent-orchestrated auto-seed: autonomous fixture creation (agent reasons, zond
  executes)
status: To Do
assignee: []
created_date: '2026-07-06 13:15'
labels:
  - project
  - fixtures
  - agent-loop
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
GOAL: let the agent autonomously create the fixtures a deep audit needs from what the API itself offers, so CRUD depth stops being gated by hand-seeded {{account}}/{{customer}}/… (run 20260706-150730: 25% test coverage, 3 CRUD suites 100% skipped, ~65 empty capture-vars).

THIS IS THE m-24 ENDGAME, NOT A REVERT OF ARV-336. Hard distinction: ARV-336 removed zond GUESSING (blind recursive cascade, 1% success on Stripe). Here the AGENT reasons (reads spec + resource-map, authors create-bodies, orders topologically, reads the 400 and FIXES the body, retries) and zond only EXECUTES (POST + capture id into .env.yaml). Decision=agent, execution=zond. The feedback loop is exactly why it succeeds where the heuristic engine failed.

SUBSTRATE ALREADY EXISTS (~80%): api annotate dump/apply --seed-bodies (agent-in-the-loop overlay), .api-resources.yaml (dep graph), db diagnose (cascade-skips + empty capture-vars), fixtures add/import (deterministic write), ARV-350 (unseeded capture-root report).

GAP = orchestration, and it lives in a SKILL/WORKFLOW, not zond core: read gap -> topological create-order -> author body -> zond run POST + capture -> on 400 fix+retry -> cascade to dependents -> report what could not be seeded and why.

HONEST CEILING: auto-seed only what is self-contained in the API; fixtures needing external input (verified bank account, webhook secret, KYC doc) are flagged, not invented (pairs with ARV-349/350).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 agent-driven seed loop lives in a skill/workflow; zond gains only deterministic primitives (dump seed-plan, execute create+capture)
- [ ] #2 loop reads a 4xx create failure, revises the body, and retries (feedback loop) — no blind cascade
- [ ] #3 auto-seed gated to live + throwaway/sandbox with cleanup
- [ ] #4 un-seedable fixtures (external input) are reported, not invented
- [ ] #5 NO auto-seed engine added to zond core (ARV-336 stays reverted)
<!-- AC:END -->
