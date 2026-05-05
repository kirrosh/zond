---
id: TASK-135
title: 'probe-validation: --use-real-parents против короткого замыкания на 404'
status: Done
assignee: []
created_date: ''
updated_date: '2026-05-05 12:19'
labels:
  - probe
  - probe-validation
  - recall
milestone: m-8
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Источник: [m-8 feedback §A](../notes/m-8-audit-cli-gaps/feedback-original.md).

В Sentry-аудите `probe-validation` сделал 2665 запросов и не нашёл ни
одного из 3 × 5xx, которые `zond run --safe` нашёл за минуту. Причина:
probe подставляет `nonexistent-zzzzz` во **все** path-параметры, включая
parent slug (`{organization_id_or_slug}`). API честно возвращает 404 на
несуществующей организации **до** того, как доберётся до валидации
вложенного `{repo_id}` / `{replay_id}`. Probe видит 404 → считает «как
ожидалось», валидация конечного path-параметра не тестируется.

## Что сделать

1. Опция `--use-real-parents` (default ON, если в `.env.yaml` есть
   соответствующие переменные): probe-validation использует реальные
   значения для parent path-params (организация, проект), а ломает только
   **leaf** path-параметр текущего endpoint'а.
2. Эвристика «что считать parent vs leaf»: parent — все path-params,
   кроме последнего, ИЛИ те, что присутствуют в `.env.yaml` с реальным
   значением. Leaf — последний параметр в шаблоне.
3. Альтернатива/расширение (опционально): матрица
   `parent ∈ {real, fake} × leaf ∈ {malformed, valid-but-missing}` —
   4 комбинации × тип, не 1. Под флагом `--matrix-parents`.
4. В `digest`/`emit-tests` указывать, какие parent-значения использовались
   (real-from-env / synthetic), чтобы легко воспроизвести.
5. Обновить probe-validation скилл-секцию (если есть) и `ZOND.md`.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Флаг `--use-real-parents` (или эквивалентное поведение по умолчанию)
      реализован и описан в `--help`.
- [ ] #2 На фикстуре с двумя реальными 5xx (моки Sentry-подобных
      `repos/{repo}/commits` + `replays/{replay_id}/...`) probe находит
      их там, где старое поведение давало 0 находок.
- [ ] #3 Тесты на эвристику parent/leaf и на резолв из `.env.yaml`.
- [ ] #4 `digest` / output логирует, что parent-значения подставлены из env.
- [ ] #5 CHANGELOG-запись.
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Реализовано: новый helper renderPath в shared.ts; ProbeOptions.useRealParents (default true); CLI флаг --no-real-parents для legacy режима. Все probeInvalidPathId / probeNumericPathParams / body+query probes используют единую логику: атакуемый path-param → литерал bad value, остальные → {{name}} (резолвится из .env.yaml на runtime). 3 новых unit-теста + skill update в Phase 5. CHANGELOG, ZOND.md, ZOND.md probe-validation секция обновлены.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
TASK-135: probe-validation больше не короткозамыкает на parent path-params (реальные значения из .env.yaml вместо nonexistent-zzzzz для не-атакуемых params). Дефолт включён, --no-real-parents для legacy. 930/930 тестов зелёных, скилл и docs обновлены.
<!-- SECTION:FINAL_SUMMARY:END -->
