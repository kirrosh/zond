---
id: ARV-266
title: >-
  retention policy for runs/results: ARV-265 follow-up (DB growth from
  checks/probe persistence)
status: To Do
assignee: []
created_date: '2026-05-17 11:44'
labels:
  - db
  - coverage
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Context

ARV-265 wired `checks run` / `probe` / `request` / `prepare-fixtures --cascade` into `runs`/`results`. Each `checks run` adds 600-1500+ rows. A solo user with daily cron-scans on one API: ~150 MB/month DB growth.

R2 in ARV-265: "runs table grows fast — long-term, need retention policy. Note for follow-up, not gating this task."

## Goal

A built-in way to bound DB growth without forcing users to remember `zond db clean` cadence.

## Options to evaluate

- **Age-based**: drop runs older than N days (configurable in zond.config.yml, e.g. `db.retention_days: 30`). Default: keep forever (back-compat).
- **Per-kind cap**: `runs.run_kind='check'` may need stricter retention than `run_kind='regular'` — check-runs are noise, regular runs are signal.
- **Per-collection cap**: keep last N runs per (collection_id, run_kind).
- **VACUUM cadence**: SQLite reclaim after large deletes.

## Acceptance Criteria

- [ ] Some retention knob exists (CLI `zond db prune --older-than 30d` and/or config `db.retention_days`)
- [ ] Default behavior unchanged (no silent data loss for users on current zond)
- [ ] Per-kind defaults documented (e.g. checks/probe/fixture retained 7d, regular forever)
- [ ] `zond db stats` (or equivalent) surfaces row counts per run_kind so users see growth

## Out of scope

- Cross-DB sharding / archival
- Encrypted backups
<!-- SECTION:DESCRIPTION:END -->
