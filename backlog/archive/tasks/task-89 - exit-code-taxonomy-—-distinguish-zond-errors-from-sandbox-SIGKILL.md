---
id: TASK-89
title: exit-code taxonomy — distinguish zond errors from sandbox/SIGKILL
status: Done
assignee: []
created_date: '2026-04-29 11:39'
updated_date: '2026-04-29 14:38'
labels:
  - cli
  - errors
  - papercut
  - docs
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Сейчас zond возвращает разные exit-коды (0 / 1 / 2) внутри своих веток, но они визуально неотличимы от:

- macOS Gatekeeper SIGKIL (отдельная задача про codesign);
- sandbox/seccomp прерываний;
- OOM kill;
- shell-level 137/143 (SIGKILL/SIGTERM).

В round-2 это давало false-positives: оператор видит `exit 137` после `zond run` и не знает, упал ли zond, ОС, или мы сами вернули `2` из-за валидации.

## Что сделать

- Зафиксировать таксономию exit-кодов (в `ZOND.md` отдельный раздел):
  - `0` — успех;
  - `1` — assertion/probe failure (тестовый артефакт, не баг zond);
  - `2` — usage / config / spec error (zond не смог запустить тест);
  - `3` — internal zond error (uncaught throw);
  - `4`+ — зарезервировать под классы (network, schema, …).
- На uncaught — печатать `[zond:internal]` префикс + версия + stack hash, чтобы отличить от внешнего kill.
- В JSON envelope (`jsonError`) добавить поле `exit_code` соответствующее тому, что вернул процесс.
- Прогнать аудит мест, где сейчас `process.exit(2)` / `process.exitCode = 2`, и привести в соответствие.

## Acceptance

- В `ZOND.md` есть раздел Exit codes.
- Любой uncaught throw даёт `[zond:internal]`-префикс и exit 3.
- В CI можно делать `if [ $rc -eq 1 ]; then # test failure; elif [ $rc -ge 128 ]; then # killed by signal; fi`.
<!-- SECTION:DESCRIPTION:END -->
