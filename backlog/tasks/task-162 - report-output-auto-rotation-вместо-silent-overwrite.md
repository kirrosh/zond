---
id: TASK-162
title: 'report --output: auto-rotation вместо silent overwrite'
status: To Do
assignee: []
created_date: '2026-05-06 06:39'
labels:
  - lifecycle
  - report
  - output
  - ux
dependencies: []
milestone: m-9
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Источник: [m-9 feedback round 5](../notes/m-9-workspace-hygiene/feedback-original.md), §P6.

CLI просто перезаписывает `--output`. Юзер вручную именовал
`security-digest-v2.md`, `v3`, `v4` чтобы не затереть. После 4
раундов в воркспейсе 4 версии digest'а с одинаковой сигнатурой
команды.

## Что сделать

1. **Auto-suffix `-vN` если файл существует.** Stdout:
   `Previous digest moved to security-digest-v3.md.`
   ```bash
   zond report ... --output security-digest.md
   # → пишет security-digest.md, переименовывает старый в security-digest-v3.md
   ```
2. **Альтернатива: флаг `--output-pattern '%Y%m%d-%H%M.md'`** для
   timestamped файлов из коробки.
3. **Флаг `--overwrite`** для явного подтверждения перезаписи без
   ротации.

Рекомендация: дефолт = auto-rotate (вариант 1), `--overwrite` для
opt-out, `--output-pattern` опционально.

## Acceptance Criteria

- [ ] При существующем `--output` файле — старый переименовывается в `-vN.md`, новый пишется по запрошенному пути.
- [ ] `--overwrite` отключает ротацию.
- [ ] Stdout сообщает о ротации с путём к старому файлу.
- [ ] Применимо ко всем `zond report *` подкомандам (digest, case-study, run-export).
<!-- SECTION:DESCRIPTION:END -->
