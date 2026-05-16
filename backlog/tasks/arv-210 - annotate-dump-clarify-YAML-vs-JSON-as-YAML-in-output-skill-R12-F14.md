---
id: ARV-210
title: 'annotate dump: clarify YAML vs JSON-as-YAML in output / skill (R12/F14)'
status: To Do
assignee: []
created_date: '2026-05-14 08:26'
updated_date: '2026-05-16 10:55'
labels:
  - feedback-loop
  - api-github
  - m-21
  - polish-m-22
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 12, finding F14, class ux-papercut, severity LOW.

Repro:
  zond api annotate dump --api github --pagination > /tmp/pagination.yaml

The output is a JSON array (valid YAML since JSON is a YAML subset) but the skill .claude/skills/zond-checks/SKILL.md pre-0 phase tells the agent to 'read the YAML structure'. Either dump should emit pretty YAML, or the skill should say 'read the JSON (which YAML-parses as a list)'.

Impact: minor disambiguation for agent prompts; output is technically valid.

Log: see feedback-12.md F14.
<!-- SECTION:DESCRIPTION:END -->
