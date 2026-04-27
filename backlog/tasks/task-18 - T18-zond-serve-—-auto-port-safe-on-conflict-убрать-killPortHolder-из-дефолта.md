---
id: TASK-18
title: >-
  T18: zond serve — auto-port + safe-on-conflict (убрать killPortHolder из
  дефолта)
status: Done
assignee: []
created_date: '2026-04-27 12:39'
updated_date: '2026-04-27 12:50'
labels:
  - T18
  - phase-4
  - size-S
  - priority-p0
  - workspace
milestone: m-0
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
**Зачем.** `src/cli/commands/serve.ts:56` вызывает `killPortHolder(port)`, который через `lsof`/PowerShell **убивает чужой процесс** на 8080. Если у пользователя там dev-сервер бэкенда — сюрприз и потеря состояния. Опасное поведение.

**Что.**
- Убрать `killPortHolder` из дефолта.
- Если порт занят → попытаться auto-pick (8080 → 8081 → 8090). Если все заняты — явная ошибка с инструкцией `--port <n>` или `--kill-existing`.
- Опциональный флаг `--kill-existing` сохраняет старое поведение для тех, кто полагается на него.
- Опционально: lock-файл `<workspace>/zond/serve.lock` с PID + порт. При повторном `zond serve` без `--port` — показать «уже работает на :8081, открой http://...».

**Файлы.** `src/cli/commands/serve.ts`, `src/web/server.ts` (поддержать `--port 0` или auto-pick через `Bun.serve`).

**Размер.** S.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 `zond serve` НЕ убивает чужой процесс на 8080 без явного флага
- [x] #2 При занятом 8080 zond пробует 8081-8090 и печатает выбранный порт в stdout
- [x] #3 `--kill-existing` восстанавливает прежнее поведение
- [x] #4 Если все порты в диапазоне 8080-8090 заняты — exit 1 с понятной ошибкой и инструкцией
<!-- AC:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Removed `killPortHolder` from `serve` default flow. New behaviour: if the requested port is busy, scan 8080..8090 (11 ports), bind first free, log fallthrough on stderr. If entire range is busy, exit 1 with instruction to use `--port <n>` or `--kill-existing`. Added `--kill-existing` CLI flag (`src/cli/program.ts`) that restores the legacy kill-then-bind behaviour. Tests in `tests/cli/serve.test.ts` covering the three acceptance scenarios. Documented in `ZOND.md` § Workspace → port handling.
<!-- SECTION:FINAL_SUMMARY:END -->
