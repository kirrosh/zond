---
id: TASK-27
title: 'T27: Smart smoke — negative+positive сьюты для single-resource эндпоинтов'
status: To Do
assignee: []
created_date: '2026-04-27 13:42'
updated_date: '2026-04-27 14:09'
labels:
  - generator
milestone: m-1
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Для эндпоинтов вида `GET /emails/{email_id}` генератор сейчас подставляет placeholder из `.env.yaml` и ставит `expect: status: 200`. На пустом аккаунте без реального ID это гарантированный фейл (~15 фейлов из 45 на первом прогоне Resend).

## Решение (после брейншторма)

Эмитим **два сьюта** на каждый single-resource endpoint, не один. 404 в одиночку не даёт уверенности в фиче, но как negative-smoke полезен (различает auth/baseUrl/route проблемы).

### Negative-smoke (запускается всегда)

- `tags: [smoke, negative]`
- ID = гарантированно несуществующий (`00000000-0000-0000-0000-000000000000` для UUID, `999999999` для int).
- `expect: status: [404, 400, 422]` (массив — некоторые API на невалидный формат UUID кидают 400/422).
- Без TODO. Сигнализирует: auth работает, base_url правильный, роут существует.

### Positive-smoke (нужен реальный ID)

- `tags: [smoke, positive, needs-id]`
- ID = `{{email_id}}` (или ключ из placeholder-эвристики).
- `expect: status: 200`.
- `skip_if: "{{email_id}} == 'example' || {{email_id}} == ''"` — скипается, если в `.env.yaml` placeholder/пусто.
- Комментарий сверху: `# TODO: set email_id in .env.yaml to enable positive smoke`.

### Поведение `zond run`

- `zond run --tag smoke` — крутит оба сьюта. Negative проходит сразу, positive скипается с понятным сообщением.
- `zond run --tag positive` — только positive (требует подставленных ID).
- `zond run --tag '!needs-id'` — выкидывает positive-smoke без ID.

## Эвристика placeholder-detection

Подставленный ID считается реальным, если:
- значение **не** в `{example, placeholder, your-id-here, "", null}`
- значение **не** содержит подстроку `example` или `placeholder`

Иначе → positive-smoke пропускается через `skip_if`.

## Acceptance

- Первый прогон сгенерированных smoke-тестов на пустом аккаунте даёт ≥90% pass rate (negative проходит, positive скипается — оба не считаются failed).
- Если пользователь подставит реальные ID, positive-smoke автоматически активируется без правки сьюта.
- `zond run --tag '!needs-id'` чистый (нет skipped).

## Out of scope (вынесено в T32)

- Auto-discovery ID через `GET /collection?limit=1` setup-сьюты.
- Интерактивный prompt у пользователя.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Эвристика placeholder-detection отличает реальные ID от заглушек
- [ ] #2 Генератор эмитит два сьюта (negative+positive) для single-resource endpoints
- [ ] #3 Negative-smoke допускает 400/404/422
- [ ] #4 Positive-smoke использует skip_if + тег needs-id, авто-активируется при реальном ID в env
- [ ] #5 Документация описывает workflow: подставил ID → positive активирован автоматически
<!-- AC:END -->
