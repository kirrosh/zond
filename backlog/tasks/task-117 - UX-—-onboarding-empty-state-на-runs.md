---
id: TASK-117
title: UX — onboarding empty-state на /runs
status: To Do
assignee: []
created_date: '2026-05-03'
updated_date: '2026-05-03'
labels:
  - ui
  - ux-polish
  - onboarding
milestone: m-7
dependencies: []
priority: high
---

## Description

При первом заходе на `/runs` без runs пользователь видит таблицу с одной строкой «No runs match the current filter» — ноль контекста, что делать дальше. Нужен полноценный onboarding-блок с тремя шагами: `zond add api --spec <path>` → `zond generate` → `zond run`, с copy-кнопкой на каждой команде и ссылками на ZOND.md соответствующих секций.

## Acceptance Criteria

- [ ] Если `runs.total === 0` И `apis.length === 0` — показывается onboarding с тремя шагами (add-api / generate / run)
- [ ] Если runs нет, но API уже зарегистрирован — onboarding пропускает шаг 1 и подсвечивает «у вас N сгенерированных сьютов, запустите `zond run`»
- [ ] Каждая команда имеет copy-to-clipboard кнопку
- [ ] Состояние «No runs match filter» (когда runs есть, но фильтр всё скрыл) — отдельный case, как сейчас
- [ ] То же самое работает для пустого `/suites`
