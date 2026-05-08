---
id: TASK-150
title: probe-mass-assignment --retry-inconclusive <run-id>
status: To Do
assignee: []
created_date: ''
updated_date: '2026-05-08 15:50'
labels:
  - probe
  - probe-mass-assignment
  - db
milestone: m-8
dependencies:
  - TASK-137
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Был частью оригинального TASK-137, выделен после реализации `--discover-fk`.
[m-8 feedback §B](../notes/m-8-audit-cli-gaps/feedback-original.md):

> --retry-inconclusive после фикстур — пересобрать только те, что были
> INCONCLUSIVE, чтобы не гонять весь пробник заново.

После того как пользователь:
1. Прогонит `probe-mass-assignment` (часть verdict'ов получит severity
   `inconclusive-baseline`).
2. Применит `zond discover --apply` или допишет `.env.yaml` руками.

…хочется быстро пересобрать **только** INCONCLUSIVE-кейсы, не гонять весь
прогон (на Sentry это 219 endpoints × несколько раундов).

## Что сделать

1. Флаг `--retry-inconclusive <run-id>` (или `<session-id>`) для
   `zond probe-mass-assignment`.
2. Из БД: достать verdicts для указанного run, отфильтровать
   `severity == "inconclusive-baseline"`, собрать список endpoints
   (`method + path`).
3. Прогнать probe-mass-assignment ровно для этих endpoints (фильтр по
   `--include` или прямой передачей).
4. Сравнить результат с предыдущим — сколько inconclusive стали ok / high.
5. Не дублировать verdicts со старого run (создаётся новый run-id).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Флаг `--retry-inconclusive <run-id>` парсит run id и достаёт
      verdicts.
- [ ] #2 Запуск ограничен endpoint-ами, которые в исходном run были
      `inconclusive-baseline`.
- [ ] #3 В выводе показано «previously inconclusive: N → resolved: K,
      still inconclusive: N-K».
- [ ] #4 Тест: фикстура с 3 INCONCLUSIVE → прогон с
      `--retry-inconclusive` после фиктивного env-апдейта → 0 INCONCLUSIVE.
- [ ] #5 CHANGELOG.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
ОТЛОЖЕНО: probe-mass-assignment не персистит verdicts в БД (нет probe_verdicts/probe_runs schema); --retry-inconclusive <run-id> требует либо нового DB-слоя для verdicts, либо парсинга markdown digest. После TASK-137 --discover-fk дефолт и резолвит большинство inconclusive-baseline на первом прогоне → niche optimization. Реализация требует архитектурного решения (DB schema vs JSON sidecar vs digest parser). Откладывается до явного запроса.
<!-- SECTION:NOTES:END -->

## Notes

После TASK-137 у нас уже есть `--discover-fk` (включён по умолчанию через
existing `--discover` flag), который в большинстве случаев устранит
`inconclusive-baseline` на первом же прогоне. `--retry-inconclusive`
полезен для случаев, когда фикстура требует ручного ввода (verified
emails, scope-permitted resource ids, и т.п.).
