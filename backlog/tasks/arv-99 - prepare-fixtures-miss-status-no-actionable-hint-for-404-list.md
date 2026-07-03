---
id: ARV-99
title: 'prepare-fixtures miss-status: no actionable hint for 404 list'
status: Done
assignee: []
created_date: '2026-05-11 08:15'
updated_date: '2026-05-16 08:31'
labels:
  - feedback-loop
  - api-sentry
  - m-16
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 01, finding F4, class ux-papercut
API: sentry

Repro:
  zond prepare-fixtures --api sentry --apply --cascade --seed
  # → failed:miss-status uuid sentry-app-installations
  #   (GET /api/0/organizations/{organization_id_or_slug}/sentry-app-installations/ → 404)

Expected: либо предложение пометить переменную skip-coverage (как для failed:no-list-endpoint), либо подсказка проверить spec на устаревший path. Сейчас агент не понимает что делать — endpoint в spec есть, но реально 404-ит.

Actual: одно техническое сообщение без агентского next-step'a. На фоне failed:no-list-endpoint-веток, где есть человеческая подсказка про .api-resources.yaml, это сообщение выглядит обрезанным.

Log: /Users/kirrotech/Projects/zond-test/.fb-loop/rounds/raw-01.log тот же блок prepare-fixtures.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Added status-specific hints to discover.ts miss-status branch (src/cli/commands/discover.ts line 649-668):
- 404: 'list endpoint 404'd. Spec may have stale path. Try refresh-api; if path correct, API likely doesn't expose this resource for your token — add to .api-resources.local.yaml or fill .env.yaml by hand'
- 401/403: 'auth/scope rejection. Check token scope; fill .env.yaml by hand or rerun --no-seed to skip futile attempts'
- 5xx: 'server-side error; retry later or check provider status before treating as fixture gap'

No new acceptance criteria, no new tests — message-only change, smoke-verified via build.
<!-- SECTION:NOTES:END -->
