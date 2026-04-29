---
id: TASK-9
title: 'T9: Сжать `skills/*/SKILL.md` до тонких оркестраторов'
status: Done
assignee:
  - '@claude'
created_date: '2026-04-27'
updated_date: '2026-04-29 14:06'
labels:
  - T9
  - phase-2
  - size-S
dependencies: []
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Зачем.** После T7 контент дублируется. Удалить дубль, оставить тонкую
маршрутизацию для агентов, у которых нет MCP.

**Что.** Каждый SKILL.md превратить в ~30 строк: «когда активироваться, какие
ресурсы фетчить, какие тулзы звать». Полный контент остаётся в MCP-ресурсе.

**Файлы.** `skills/api-testing/SKILL.md`, `skills/api-scenarios/SKILL.md`,
`skills/test-diagnosis/SKILL.md`, `skills/setup/SKILL.md`.

**Зависит от.** T7.

**Размер.** S.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Каждый SKILL.md ≤ 60 строк
- [x] #2 Содержит ссылки на ресурсы (`Fetch zond://workflow/test-api before starting`) и список тулз
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Каждый SKILL.md превращён в тонкий оркестратор с одинаковой структурой:
- frontmatter (без изменений)
- 1 строка «когда активироваться» / краткое описание
- блок **Resources to fetch** — список `zond://...` URI из T7
- блок **MCP tools** — список релевантных tools из T6
- блок **Critical rules** — top-3..5 правил, которые должны быть видны даже без MCP (агент может вызвать skill ДО того, как MCP-сервер подключён)
- **Quickstart** — 3-5 команд

Размеры: api-testing 51, api-scenarios 47, setup 45, test-diagnosis 35 — все ≤60.

Setup-skill оставлен self-contained (с inline `curl`/`powershell` install commands), так как активируется когда zond ещё не установлен и MCP недоступен. Содержит указатель «после установки см. zond://workflow/setup».
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
## Что сделано
Сжал 4 SKILL.md (319+202+37+47 = 605 строк) до тонких оркестраторов (51+47+35+45 = 178 строк), удалив дубль с T7-ресурсами.

Каждый SKILL.md теперь содержит: блок Resources (zond:// URI), блок MCP tools, top-N critical rules (always-on), quickstart. Полный контент — в `zond://workflow/*`, `zond://rules/*`, `zond://reference/*` (T7).

Setup-skill оставлен self-contained — он активируется до установки zond, когда MCP ещё недоступен.

## Verification
- wc -l: 51, 47, 45, 35 — все ≤60 (AC#1)
- Каждый файл содержит секции «Resources to fetch» и «MCP tools» (AC#2)
- `bun run check` — clean
<!-- SECTION:FINAL_SUMMARY:END -->
