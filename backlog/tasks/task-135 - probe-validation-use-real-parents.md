---
id: TASK-135
title: 'probe-validation: --use-real-parents против короткого замыкания на 404'
status: To Do
assignee: []
labels:
  - probe
  - probe-validation
  - recall
milestone: m-8
dependencies: []
priority: high
---

## Description

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

## Acceptance Criteria

- [ ] Флаг `--use-real-parents` (или эквивалентное поведение по умолчанию)
      реализован и описан в `--help`.
- [ ] На фикстуре с двумя реальными 5xx (моки Sentry-подобных
      `repos/{repo}/commits` + `replays/{replay_id}/...`) probe находит
      их там, где старое поведение давало 0 находок.
- [ ] Тесты на эвристику parent/leaf и на резолв из `.env.yaml`.
- [ ] `digest` / output логирует, что parent-значения подставлены из env.
- [ ] CHANGELOG-запись.
