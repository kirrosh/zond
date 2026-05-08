---
id: TASK-125
title: testing — axe-core accessibility audit в e2e
status: To Do
assignee: []
created_date: '2026-05-03'
updated_date: '2026-05-08 13:10'
labels:
  - testing
  - ui
  - ux-polish
  - a11y
milestone: m-7
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Поверх Playwright-харнеса добавить `@axe-core/playwright` и проверять каждый из 4 экранов на accessibility violations. Fail при `serious`/`critical`. Цель — не идеальный a11y-rating, а отлов регрессий: пропущенный `aria-label` на icon-button, плохой контраст badge'а, форма без label'а.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 `@axe-core/playwright` добавлен в devDependencies
- [ ] #2 В каждом из 4 e2e-spec'ов финальный шаг — axe-сканирование экрана
- [ ] #3 Тест fail'ит при `impact === 'serious'` или `'critical'`
- [ ] #4 Допустимые violations (если найдутся легитимные false positives) задокументированы в `tests/e2e/a11y-allowlist.ts`
- [ ] #5 Текущие violations исправлены ДО merge — не накапливать
<!-- AC:END -->
