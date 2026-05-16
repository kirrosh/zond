---
id: TASK-128
title: testing — visual regression через Playwright toHaveScreenshot
status: To Do
assignee: []
created_date: '2026-05-03'
updated_date: '2026-05-08 13:10'
labels:
  - testing
  - ui
  - ux-polish
milestone: m-7
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Поверх e2e-харнеса (TASK-124) добавить visual regression: `toHaveScreenshot()` на стабильных состояниях 4 экранов. Цена внедрения низкая, ловит регрессии Tailwind / shadcn-апгрейдов и случайные правки спейсингов.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 В каждом из 4 e2e-spec'ов финальный (или дополнительный) шаг — `await expect(page).toHaveScreenshot()`
- [ ] #2 Baseline snapshots коммитятся в `tests/e2e/__screenshots__/`
- [ ] #3 Snapshots версионируются по платформе (linux/darwin отдельно) — в имени файла
- [ ] #4 CI запускает только linux-snapshots; darwin — для локальной разработки
- [ ] #5 Документировано в `tests/e2e/README.md` как обновить baseline (`bun run test:e2e --update-snapshots`)
<!-- AC:END -->
