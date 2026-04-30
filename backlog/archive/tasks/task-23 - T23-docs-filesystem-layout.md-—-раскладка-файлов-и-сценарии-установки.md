---
id: TASK-23
title: 'T23: docs/filesystem-layout.md — раскладка файлов и сценарии установки'
status: To Do
assignee: []
created_date: '2026-04-27 12:39'
updated_date: '2026-04-29 14:06'
labels:
  - T23
  - phase-4
  - size-XS
  - priority-p3
  - workspace
  - docs
milestone: m-0
dependencies:
  - TASK-17
  - TASK-18
priority: low
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Зачем.** После T17-T22 у zond появятся 2-3 поддерживаемые раскладки файлов (плоская в cwd, `zond/` subdir, monorepo). Без явной документации пользователь не знает, что выбрать и где что искать.

**Что.** Документ `docs/filesystem-layout.md` со схемой для трёх сценариев:
- **S1**: пустая папка для тестирования 3rd-party API (например, GitHub) — плоская раскладка
- **S2**: embed в существующий backend (`zond init --here`, `zond/` subdir)
- **S3**: monorepo с несколькими API — workspace marker, walk-up

Для каждого: ascii-схема дерева, что попадает в `.gitignore`, что коммитится, как взаимодействуют workspace root + `.zond-current` + `--api` flag.

Плюс краткий блок про конкурентность: что произойдёт при параллельных `zond run`/`zond serve`/`zond mcp start`.

**Файлы.** `docs/filesystem-layout.md` (новый), упоминание из README.md и AGENTS.md.

**Зависит от.** T17, T18, T19 — должны быть реализованы, чтобы документ описывал реальность, а не план.

**Размер.** XS.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 docs/filesystem-layout.md существует, описывает 3 сценария с ascii-деревом
- [ ] #2 README.md и AGENTS.md ссылаются на новый документ
- [ ] #3 Документ упоминает что коммитить, что в .gitignore, что в `.zond-current`
<!-- AC:END -->
