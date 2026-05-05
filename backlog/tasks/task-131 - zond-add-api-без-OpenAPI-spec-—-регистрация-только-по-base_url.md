---
id: TASK-131
title: zond add api без OpenAPI spec — регистрация только по base_url
status: Done
assignee: []
created_date: '2026-05-05 10:04'
updated_date: '2026-05-05 10:20'
labels: []
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Сейчас `zond add api` без spec.json оставляет API «полупустым»: `zond doctor --api <name>` отвечает «API not found», `zond run --api` не резолвит base_url, probe-команды просто падают.

Нужно поддержать spec-less регистрацию:
- `zond add api <name> --base-url <url>` без `--spec` создаёт запись в БД и .env.yaml
- `zond doctor --api <name>` видит такой API и явно сообщает «no spec — generate/probe disabled»
- probe-команды (probe-validation/probe-methods/probe-mass-assignment/...) при отсутствии spec выдают понятную ошибку: «spec needed, run `zond add api <name> --spec <path>`»
- `zond run --api <name>` подхватывает base_url для относительных путей в YAML

Источник: фидбэк по тестированию JSONPlaceholder (mock-API без OpenAPI).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 zond add api --base-url без --spec успешно регистрирует API
- [ ] #2 zond doctor видит spec-less API и сообщает о недоступности generate/probe
- [ ] #3 probe-команды без spec возвращают понятный actionable error
- [ ] #4 zond run --api резолвит base_url для spec-less API
<!-- AC:END -->
