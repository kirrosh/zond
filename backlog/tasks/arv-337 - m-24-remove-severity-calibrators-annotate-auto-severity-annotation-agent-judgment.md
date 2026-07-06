---
id: ARV-337
title: >-
  m-24 remove severity calibrators + annotate auto; severity/annotation = agent
  judgment
status: To Do
assignee: []
created_date: '2026-07-06 07:14'
labels:
  - m-24
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Per decision-9: severity is a judgment call the agent now makes better than hardcoded calibrators (ARV-300/311 lineage). Remove the calibrator layer and annotate-auto heuristics. Checks/probes still emit raw evidence; the agent assigns severity. Keep the mechanical evidence, drop the scoring heuristics.
<!-- SECTION:DESCRIPTION:END -->
