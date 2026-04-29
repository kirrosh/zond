---
id: TASK-87
title: macOS adhoc codesign zond binary in build pipeline
status: To Do
assignee: []
created_date: '2026-04-29 11:38'
labels:
  - build
  - macos
  - papercut
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

После каждого `bun run build` macOS Gatekeeper SIGKILит свежий бинарь zond с `code signature in subcomponent ... is not valid` / `code or signature have been modified`. Bun-сборка не подписана, и `kill: 9` визуально неотличим от обычного падения, поэтому в round-2 пропадало 5+ минут на диагностику.

Воркэраунд, который реально работает: `codesign --force --sign - $(which zond)` (adhoc-подпись) после каждой пересборки. Без этого пользователь сам должен догадаться, что упал не zond, а LaunchServices.

## Что сделать

- В `package.json` post-build шаг (`postbuild` или внутри `build`-скрипта): на darwin прогонять `codesign --force --sign - <outfile>`. На других платформах — no-op.
- Если codesign отсутствует — печатать понятный warning, не падать.
- В `docs/ci.md` (или релизном чеклисте) пометить, что на CI нужна нормальная подпись (Developer ID), а adhoc — только для локальных сборок.

## Acceptance

- `bun run build && ./zond --version` на macOS работает с холодного старта без ручного codesign.
- На linux/windows скрипт не падает.
- В CHANGELOG / docs упомянуто, какой именно случай это закрывает (Gatekeeper SIGKIL).
<!-- SECTION:DESCRIPTION:END -->
