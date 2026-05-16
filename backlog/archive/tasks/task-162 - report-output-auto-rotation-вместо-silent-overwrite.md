---
id: TASK-162
title: 'report --output: auto-rotation вместо silent overwrite'
status: Done
assignee: []
created_date: '2026-05-06 06:39'
updated_date: '2026-05-06 11:02'
labels:
  - lifecycle
  - report
  - output
  - ux
milestone: m-9
dependencies: []
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
<!-- AC:BEGIN -->
- [ ] #1 При существующем `--output` файле — старый переименовывается в `-vN.md`, новый пишется по запрошенному пути.
- [ ] #2 `--overwrite` отключает ротацию.
- [ ] #3 Stdout сообщает о ротации с путём к старому файлу.
- [ ] #4 Применимо ко всем `zond report *` подкомандам (digest, case-study, run-export).
<!-- SECTION:DESCRIPTION:END -->

<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
src/core/workspace/output-rotation.ts: rotateOutputTarget() — переименовывает существующий файл в <stem>-vN.<ext>, --overwrite опт-аут. Применён в report export (HTML), report case-study, probe-mass-assignment, probe-security. CLI флаги --overwrite добавлены. 6 unit-тестов.
<!-- SECTION:NOTES:END -->
