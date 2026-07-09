---
id: ARV-377
title: >-
  no CLI to write .secrets.yaml — forced hand-rolled python to rotate an expired
  auth_token
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
Session: docgen-core-service Keycloak JWT expired mid-audit. User pasted a fresh token (with a `Bearer ` prefix, the exact trap already documented in ARV-367 UX1/AC3). There is no `zond secrets set <key> <value>` — `zond fixtures add` only writes `.env.yaml`, and iron rules correctly forbid reading `.secrets.yaml` directly. Net result: I had to hand-write a python script to open `.secrets.yaml`, find the `auth_token:` line, strip the `Bearer ` prefix, and rewrite the value — for three sibling workspaces.

Proposed: `zond secrets set <key> <value> --api <name>` (mirrors `zond fixtures add` semantics: writes with a `.bak` backup, never echoes the value back). When the key is bound to an `apiKey`-scheme securityScheme in the spec (same detection ARV-367/AC3 already scoped for doctor/add-api), auto-strip a leading `Bearer ` (case-insensitive) before writing and warn once ("apiKey scheme expects a raw token — stripped a Bearer prefix you pasted"), instead of just hinting and leaving the human to get it right.

Optional nice-to-have surfaced same session: `zond add api <name> --auth-from <existing-api>` to copy an already-verified secrets file when registering a sibling API against the same auth backend (I used `cp` between three workspace `.secrets.yaml` files by hand). Lower priority than the `secrets set` command itself.

This closes AC3 of ARV-367 (still open) with an actual command instead of just a doctor/add-api warning.

Litmus test: deterministic file write + deterministic prefix-strip, no severity/FP/blame judgment — belongs in zond core.
<!-- SECTION:DESCRIPTION:END -->
