---
id: TASK-108
title: 'trust-loop: interactive request replay в zond serve (edit-and-resend)'
status: To Do
assignee: []
created_date: '2026-04-30 12:17'
labels:
  - ui
  - trust-loop
  - replay
dependencies: []
milestone: m-6
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Decision-5 open question: «какая минимальная форма interactive replay в zond serve отвечает на дайте мне понажимать в запрос». Эта фича — главный магнит trust-loop: одновременно делает demo-видео виральным («click → tweak → resend») и закрывает ежедневный use-case «мне нужно потыкать конкретный запрос», ради которого пользователь сейчас уходит в Postman/Bruno.

Сейчас в Run detail на failure-card ты видишь request/response, но не можешь ничего изменить и переотправить. Надо сделать минимальный edit-and-resend, не превращая zond в Postman-конструктор.

## Что сделать

В Run detail UI на failure-card добавить кнопку «Replay». При клике открывается панель с:

1. Editable полями: method (dropdown), URL (text), headers (key-value rows), body (textarea с JSON detection и подсветкой).
2. Variable interpolation: те же `{{var}}` что и в YAML, доступ к captured values из run + .env.yaml текущего workspace.
3. Кнопка Send: отправляет HTTP-запрос (через тот же runner что и `zond run`), показывает response рядом — статус, headers, body, длительность.
4. Diff с оригинальным запросом: подсветить, что было изменено.
5. Кнопка «Save as YAML step»: сериализовать текущий запрос обратно в suite-формат zond, скопировать в clipboard.
6. История replay'ев в рамках сессии (локально, не в SQLite — это не run).

Out of scope: коллекции, environments-management, история между сессиями, импорт из Postman. Это не Postman-replacement, это «дай потыкать failure».

## Acceptance

- Replay-кнопка на failure-card открывает редактируемую панель.
- Send отправляет запрос через zond runner (тот же auth/interpolation/timing).
- Response рендерится с тем же форматированием, что и в run.
- «Save as YAML» даёт корректный suite-step.
- Variable interpolation работает (резолвит `{{base_url}}`, `{{captured.id}}`).
- Нет регрессии в существующих экранах serve.

## Стратегическая ценность

Делает zond ежедневным инструментом, а не «прогнал-и-забыл». Demo-видео магнит. Закрывает open question decision-5.
<!-- SECTION:DESCRIPTION:END -->
