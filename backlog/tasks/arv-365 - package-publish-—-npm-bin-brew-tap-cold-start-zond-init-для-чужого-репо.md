---
id: ARV-365
title: package & publish — npm bin + brew tap + cold-start zond init для чужого репо
status: To Do
assignee: []
created_date: '2026-07-08 07:14'
labels:
  - m-25
  - distribution
dependencies:
  - ARV-364
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
zond технически готов, но им нельзя воспользоваться, не будучи мной. Упаковать: npm-паблиш (bin + dist, npm i -g zond), brew tap/formula, и cold-start zond init в чужом репозитории — без допущений о существующем workspace/ключах, с дозапросом недостающего. Это блокер №1 для decision-8 (hygiene scanner для маленьких команд).

ponytail: не городить CI-релиз-пайплайн, если хватает gh release + npm publish вручную; brew — tap с одной формулой, не отдельный репо-комбайн.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 npm i -g zond (или scoped) ставит рабочий bin на чистой машине
- [ ] #2 brew install через tap ставит тот же bin
- [ ] #3 zond init в пустом чужом репо доводит до первого прогона без ручной правки внутренностей workspace
<!-- AC:END -->
