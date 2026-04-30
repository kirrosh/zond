---
id: TASK-104
title: UI — provenance + spec snippet в Run detail evidence panel
status: To Do
assignee: []
created_date: '2026-04-30 09:36'
labels:
  - trust-loop
  - decision-5
  - ui
dependencies:
  - TASK-100
  - TASK-102
  - TASK-103
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

После TASK-100 (provenance) и TASK-102 (spec pointer) каждый failure
несёт source-блок и JSON pointer + excerpt. UI должен показывать это
рядом с request/response, чтобы backend в одной плоскости видел
«что мы тестировали → что ожидали по спеке → что вернулось».

## Что добавляется в Run detail

В Evidence panel (рядом с Request/Response/Assertions табами) появляется
новый таб **Source** или новая секция в Header failure-карточки:

- **Provenance**:
  - Generator badge: `openapi-generated` / `negative-probe` / `manual` / etc.
  - Endpoint: `POST /webhooks` (моноширинный)
  - Response branch: `422` (если есть)
  - Если manual: только бейдж "manually authored", остальное скрыто.

- **Spec snippet** (если spec_pointer != null):
  - JSON pointer как ссылка / breadcrumb (`#/paths/.../responses/422`)
  - Excerpt из схемы (тот, что в DB), pretty-printed
  - Кнопка copy pointer

## Из NON-целей

- Не делаем full Swagger UI рендер. Только excerpt из spec_excerpt
  поля DB.
- Не делаем live-загрузку текущего spec файла — может быть устарелым;
  показываем frozen-on-run версию.

## Где код

- `src/ui/client/src/routes/run-detail.tsx` — расширить EvidencePanel.
- Может быть выделение нового компонента ProvenanceBlock.
- API: `/api/runs/:id` уже отдаёт provenance/spec_pointer/excerpt после
  TASK-100/102.

## Тесты

- Smoke: failure с openapi-generated provenance рендерит endpoint +
  pointer + excerpt.
- Failure с manual source рендерит только "manually authored" бейдж.
- Failure без provenance (старые runs) → скрытие секции, без crash.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Generator/endpoint/response_branch/manual бейджи рендерятся корректно по типу source
- [ ] #2 Spec excerpt отображается с pretty-formatting + copy-pointer кнопка
- [ ] #3 Failure без provenance (старый run) скрывает секцию, не падает
<!-- AC:END -->
