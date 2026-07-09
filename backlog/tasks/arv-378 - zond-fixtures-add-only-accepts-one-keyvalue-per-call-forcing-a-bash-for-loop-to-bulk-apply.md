---
id: ARV-378
title: >-
  zond fixtures add only accepts one key=value per call, forcing a bash for-loop
  to bulk-apply
status: To Do
assignee: []
created_date: '2026-07-09 08:53'
labels:
  - feature
  - cli
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Session: after prepare-fixtures/manual discovery surfaced 21 real v20 fixture values (template20_id, template20_code, textBlockId, etc.), applying them required:

  for p in "${pairs[@]}"; do zond fixtures add "$p" --apply; done

21 separate zond invocations wrapped in a bash for-loop. This is the exact anti-pattern already flagged in project memory (feedback_no_shell_around_zond): "for ... zond request ... done = backlog task in core, not skill snippet" — same shape, `fixtures add` instead of `request`, same root problem (no batch primitive).

Proposed (either, or both):
1. `zond fixtures add k1=v1 k2=v2 k3=v3 ... --apply` — accept multiple key=value pairs in one invocation, one .env.yaml write + one .bak backup instead of N.
2. Reuse zond's own dump-then-apply pattern (already established for `zond api annotate dump/apply`) for fixture candidates: `zond prepare-fixtures --api <name> --dump candidates.yaml` emits the gap list in the same agent-writable YAML shape as annotate, the agent fills in chosen values, `zond fixtures apply --input candidates.yaml --apply` writes them all at once. This would also naturally subsume ARV-376 (once list-endpoint candidates are surfaced, the agent picks from `item.candidates` and writes the same file back) — one coherent workflow instead of two separate CLI gaps.

Litmus test: batch application of agent-supplied values is mechanical I/O, not judgment (which value to pick IS the agent's judgment and stays that way) — belongs in zond core.
<!-- SECTION:DESCRIPTION:END -->
