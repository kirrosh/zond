---
id: TASK-18
title: >-
  T18: zond serve — auto-port + safe-on-conflict (убрать killPortHolder из
  дефолта)
status: To Do
assignee: []
created_date: '2026-04-27 12:39'
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
- [ ] #1 `zond serve` НЕ убивает чужой процесс на 8080 без явного флага
- [ ] #2 При занятом 8080 zond пробует 8081-8090 и печатает выбранный порт в stdout
- [ ] #3 `--kill-existing` восстанавливает прежнее поведение
- [ ] #4 Если все порты в диапазоне 8080-8090 заняты — exit 1 с понятной ошибкой и инструкцией
<!-- AC:END -->
