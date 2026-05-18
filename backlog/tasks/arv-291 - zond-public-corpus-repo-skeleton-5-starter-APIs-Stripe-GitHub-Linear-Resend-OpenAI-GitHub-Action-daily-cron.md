---
id: ARV-291
title: >-
  zond-public-corpus repo skeleton: 5 starter APIs
  (Stripe/GitHub/Linear/Resend/OpenAI) + GitHub Action daily cron
status: To Do
assignee: []
created_date: '2026-05-18 11:35'
labels:
  - m-23
  - corpus
  - ops
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

m-23 epic: separate GitHub repo `zond-public-corpus` — dogfood + content engine. Не часть основного zond repo (разные обновления, разный аудитор).

## Решение

New repo layout:
```
zond-public-corpus/
├── apis/<vendor>/
│   ├── spec.json (frozen, manual updates)
│   ├── .env.yaml (tokens via secrets)
│   ├── .api-resources.local.yaml
│   └── .zond/severity.yaml (per-vendor overlay)
├── runs/<date>/<vendor>.ndjson
├── reports/<date>.md (auto)
├── trends/<vendor>.csv (auto append)
└── .github/workflows/daily.yml
```

5 starter API: Stripe, GitHub, Linear, Resend, OpenAI. Все с публичными OpenAPI и available test/sandbox accounts.

## Acceptance Criteria

- [ ] #1 Repo created, README объясняет purpose (dogfood + showcase, not calibration)
- [ ] #2 5 APIs со spec.json + минимальный .env.yaml
- [ ] #3 GitHub Action daily cron — `zond corpus run --safe --budget standard`
- [ ] #4 Action commits results back to runs/ + reports/ + trends/
- [ ] #5 Repo made public после week-4 gate

## Связано

- m-23, ARV-290 (corpus run), ARV-291 (diff)
<!-- SECTION:DESCRIPTION:END -->
