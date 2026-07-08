---
id: ARV-294
title: npm package + brew formula publishing pipeline (zond v0.24.0)
status: To Do
assignee: []
created_date: '2026-05-18 11:36'
labels:
  - m-23
  - distribution
  - release
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

zond сейчас local-build only: `bun run build && cp ./dist/zond ~/.local/bin/zond`. Для m-23 distribution трека нужен install surface: `npm i -g @zond/cli` или `brew install zond`.

Без этого любая HN/Reddit submission приведёт пользователей к «как же мне его поставить?» → bounce.

## Решение

**npm package** (primary):
- bun build → standalone binary (per platform: darwin-x64/darwin-arm64/linux-x64)
- postinstall script достаёт правильный бинарь
- package name: `@zond/cli` или `zond-cli` (проверить availability)
- semver: v0.24.0 как первый publish

**brew formula** (secondary):
- Homebrew tap (`anthropic/zond` или личный) с formula
- `brew install <tap>/zond`

CI pipeline:
- GitHub Action: tag → build → publish to npm + brew
- Verify install matrix: macOS arm64/x64, Linux x64

## Acceptance Criteria

- [ ] #1 npm package published, `npx zond --version` works
- [ ] #2 brew formula published, `brew install <tap>/zond` works
- [ ] #3 Install verification CI passes on macOS arm64
- [ ] #4 Release notes для v0.24.0 в CHANGELOG.md

## Связано

- m-23 трек 3
<!-- SECTION:DESCRIPTION:END -->
