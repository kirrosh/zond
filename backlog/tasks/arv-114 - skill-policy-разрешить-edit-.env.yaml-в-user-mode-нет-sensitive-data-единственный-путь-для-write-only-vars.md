---
id: ARV-114
title: >-
  skill / policy: разрешить edit .env.yaml в user-mode (нет sensitive data,
  единственный путь для write-only vars)
status: To Do
assignee: []
created_date: '2026-05-11 09:21'
labels:
  - zond
  - skill-drift
  - policy
dependencies: []
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Skill сейчас явно запрещает агенту править `.env.yaml` напрямую — все vars должны идти через `prepare-fixtures` / cascade. Это валидное правило для secrets, но в zond `.env.yaml` хранит только values (по решению из project_artifacts_model), а secrets идут отдельно.

В раунде 4 пользователь подтвердил, что чувствительных данных в `.env.yaml` больше нет — значит запрет ломает легитимные сценарии:
- write-only vars (`event_id`, `issue_id`), которые нельзя получить через harvest
- ручные corrections, когда auto-found value заведомо неверен (например, environment подхватился не тот)

Опции:
1. Снять запрет полностью в skill (пометить как "OK to edit values, NEVER edit manifest .api-fixtures.yaml").
2. Оставить запрет, но открыть white-listed escape hatch (`zond fixture set <var> <value> --source manual` с явным provenance).

Связано с F18 (extend .api-resources) — если extension API будет, ручной edit `.env.yaml` останется как fallback, не как основной workaround.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 решение зафиксировано: полное снятие запрета vs whitelisted CLI
- [ ] #2 skill (zond-base.md) обновлён под решение
- [ ] #3 если выбран CLI-путь — реализован `zond fixture set` с provenance `source: manual`
<!-- AC:END -->
