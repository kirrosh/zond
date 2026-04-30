---
id: TASK-107
title: 'trust-loop: HTML export run-репорта (single-file shareable)'
status: To Do
assignee: []
created_date: '2026-04-30 12:16'
labels:
  - ui
  - trust-loop
  - reporting
dependencies: []
milestone: m-6
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Decision-5 ставит open question: «формализовать evidence-chain как публикуемый артефакт (HTML/PDF-репорт пригодный к шерингу с бэкендером) или достаточно ссылки на локальный zond serve». Решаем в пользу HTML-export.

Сейчас run живёт в SQLite и в zond serve. Чтобы показать коллеге/в твиттере/в тикете — надо скриншотить и копировать curl вручную. Это трение убивает контент-байпродукт и дефенсибельность находок.

## Что сделать

Команда: `zond report export --html <run-id> [-o report.html]`. На выходе — single-file HTML (inline CSS, без внешних ассетов), который содержит:

1. Run summary: spec name, base_url, timestamp, totals (pass/fail/error), длительность.
2. Failure cards (только failed/errored), для каждой:
   - endpoint + method + status badge
   - failure_class (`definitely_bug` / `likely_bug` / `quirk` / `env_issue`)
   - provenance (источник теста: какой generator, какая ветка спеки)
   - spec snippet (JSON pointer + контекст из OpenAPI)
   - request/response пара (headers + body, syntax-highlighted)
   - готовый `curl` для repro (copy-button)
3. Coverage сводка: endpoints × methods × status_classes (как в UI Coverage map, но статичный snapshot).
4. Footer: версия zond, ссылка на проект.

Технически: переиспользовать существующие renderer'ы из src/ui/ через server-side render (или простой template-engine), результат собрать в один HTML с inline assets.

## Acceptance

- `zond report export --html <run-id>` создаёт single-file HTML без внешних зависимостей.
- Файл открывается в любом браузере без серверa, выглядит как Run detail из serve.
- Включает все failure cards с provenance + evidence + curl.
- Размер разумный (< 2 МБ для типичного run на 50 эндпоинтов).
- Экзитится с понятным текстом, если run-id не найден.

## Стратегическая ценность

Multiplier для контент-байпродукта: каждый run → потенциальный публичный артефакт без ручной работы. Закрывает open question decision-5. Ключевой enabler для validation-path (Stripe/Resend write-up'ы).
<!-- SECTION:DESCRIPTION:END -->
