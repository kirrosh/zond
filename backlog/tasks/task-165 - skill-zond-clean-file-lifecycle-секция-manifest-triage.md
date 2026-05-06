---
id: TASK-165
title: 'skill: zond clean / file-lifecycle секция (manifest, triage/)'
status: To Do
assignee: []
created_date: '2026-05-06 06:39'
updated_date: '2026-05-06 06:40'
labels:
  - skill
  - docs
  - lifecycle
milestone: m-9
dependencies:
  - TASK-156
  - TASK-162
  - TASK-163
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Источник: [m-9 feedback round 5](../notes/m-9-workspace-hygiene/feedback-original.md), §P9-P10.

После закрытия задач m-9 (TASK-156, TASK-159, TASK-162, TASK-163)
скилл `zond` должен научить агента:

- куда смотреть, чтобы понять «что zond сгенерил» (`.zond/manifest.json`);
- когда чистить (`zond clean --api <name> --dry-run`);
- куда писать триаж-артефакты по дефолту (`triage/<api>/<run>/`);
- как ротируются digest'ы (auto-suffix `-vN`).

Сейчас в скилле этого нет — агент сам изобретает `triage/`,
именует digest'ы вручную, не подозревает про manifest.

## Что сделать

1. Новая секция skill'а **«File lifecycle»** (или подсекция в Phase 6):
   - что zond создаёт (workspace/api/probes/triage уровни);
   - manifest как source of truth;
   - `zond clean` — когда и зачем (после bug-fix'ов в шаблонах,
     после неудачных экспериментов).
2. Entry-point row:
   | «Воркспейс захламился, начать с чистого листа» | `zond clean --api <name> --dry-run` → `--force` |
3. Phase 5 / probe-emit blurb: «output-файлы попадают в `triage/<api>/<run>/`
   автоматически; ручной `--output` не нужен в 95% случаев».
4. Update `init` template skill, не забыть AGENTS.md.

Зависит от: TASK-156 (manifest+clean), TASK-163 (default triage/),
TASK-162 (auto-rotate digest).

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Секция «File lifecycle» в skill'е.
- [ ] #2 Entry-point row про `zond clean`.
- [ ] #3 Упоминание `triage/<api>/<run>/` как дефолтного пути.
- [ ] #4 Phase про обновление manifest при ручном edit'е (sha256 mismatch → skip).
- [ ] #5 Skill в `init` template обновлён (не забыть pre-installed для new workspaces).
<!-- SECTION:DESCRIPTION:END -->
<!-- AC:END -->
