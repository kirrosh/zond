---
id: TASK-128
title: testing — visual regression через Playwright toHaveScreenshot
status: To Do
assignee: []
created_date: '2026-05-03'
updated_date: '2026-05-03'
labels:
  - testing
  - ui
  - ux-polish
milestone: m-7
dependencies:
  - TASK-124
priority: medium
---

## Description

Поверх e2e-харнеса (TASK-124) добавить visual regression: `toHaveScreenshot()` на стабильных состояниях 4 экранов. Цена внедрения низкая, ловит регрессии Tailwind / shadcn-апгрейдов и случайные правки спейсингов.

## Acceptance Criteria

- [ ] В каждом из 4 e2e-spec'ов финальный (или дополнительный) шаг — `await expect(page).toHaveScreenshot()`
- [ ] Baseline snapshots коммитятся в `tests/e2e/__screenshots__/`
- [ ] Snapshots версионируются по платформе (linux/darwin отдельно) — в имени файла
- [ ] CI запускает только linux-snapshots; darwin — для локальной разработки
- [ ] Документировано в `tests/e2e/README.md` как обновить baseline (`bun run test:e2e --update-snapshots`)
