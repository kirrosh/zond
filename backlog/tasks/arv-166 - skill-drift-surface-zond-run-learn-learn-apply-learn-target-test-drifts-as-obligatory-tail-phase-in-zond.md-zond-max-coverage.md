---
id: ARV-166
title: >-
  skill drift: surface 'zond run --learn --learn-apply --learn-target
  test|drifts' as obligatory tail-phase in zond.md / zond-max-coverage
status: To Do
assignee: []
created_date: '2026-05-12 12:46'
labels:
  - feedback-loop
  - skill-drift
  - m-16
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 09 — pass-coverage R07→R09 прыжок 28%→58% произошёл ровно после того как тестер сам нашёл --learn-apply test. До этого 5 раундов skill его не упоминал как обязательную стадию.

Expected: skills (zond.md, zond-max-coverage если адаптируем ARV-160) перечисляют tail-фазу после initial run:
1. zond run --learn (без apply) → посмотреть rewrites count
2. zond run --learn --learn-apply --learn-target drifts → если spec-vs-server drift валидный (документировано)
3. zond run --learn --learn-apply --learn-target test → если хочется снять статус failed с шагов где реальный response стабильно != spec (с явной пометкой: это weakens assertions)

Текущее состояние: zond.md упоминает --learn пару раз вскользь, --learn-apply не упоминается; --learn-target вообще нет в каталоге.

Caveat (важно — должно быть в skill'е): --learn-apply test не верифицирует код, а ослабляет assertions. На каждый apply нужен ревью diff'а tolerated-drifts.yaml / expect.status переписанных шагов.

Effect: новый юзер с свежим skill'ом дойдёт до R09-уровня за 1–2 сессии, не за 9.

См. также: ARV-160 (zond-max-coverage skill), feedback-09.md §3 'Что делал'.
<!-- SECTION:DESCRIPTION:END -->
