---
id: TASK-120
title: UX — glossary modal для доменных терминов (?)
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

Термины `cascade`, `provenance`, `partial-failed`, `ephemeral-only`, `definitely_bug` / `likely_bug` / `quirk`, `primary` / `schema` / `auxiliary` assertion — стена для новичка. Часть закрыта tooltip'ами (coverage), но в run-detail нет. Нужна единая glossary-модалка, открываемая по `?` (keyboard) или по иконке в хедере, плюс inline-`?` рядом с самими терминами.

## Acceptance Criteria

- [ ] Глобальная клавиша `?` открывает glossary modal с описаниями всех терминов
- [ ] В модалке термины сгруппированы: failures / coverage / provenance / assertions
- [ ] Иконка `(?)` рядом с `Cascade skips`, `Source`, `partial-failed` (в coverage) — открывает модалку и скроллит к нужному термину
- [ ] Каждый термин имеет ссылку на соответствующую секцию AGENTS.md / ZOND.md
- [ ] Контент glossary живёт в одном файле (`src/ui/client/src/lib/glossary.ts`), а не размазан по компонентам
