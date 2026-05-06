---
id: m-9
title: "workspace-hygiene"
---

## Description

Гигиена воркспейса и file-lifecycle: то, что zond создаёт на диске,
как пользователь это распознаёт, чистит и ротирует. Источник правды:
[notes/m-9-workspace-hygiene/feedback-original.md](../notes/m-9-workspace-hygiene/feedback-original.md)
(round 5, structural review of Sentry workspace: 362 файла, 27 MB,
329 — auto-generated YAML).

Главный вывод аудита: **узкое место — не качество тестов, а энтропия
воркспейса после нескольких итераций.** stale probe-suites, дубликаты
`.api-catalog.yaml`/`.env.yaml`, ручной versioning digest'ов, отсутствие
manifest'а «что zond сгенерил» — всё это превращает воркспейс в свалку
после 6 раундов. Smoke и probe-recall — отдельные оси (m-1, m-8); этот
майлстоун **только про file-lifecycle**.

### Цели майлстоуна

1. **`zond clean` + manifest (P9, P10).** `.zond/manifest.json` со
   sha256 каждого автогенерённого файла; `zond clean` удаляет только
   свои файлы, не трогает пользовательские. Критично для итеративной
   работы.
2. **Не дублировать root-артефакты в subdirs (P1, P2).** Убрать
   `tests/.api-catalog.yaml` и `tests/.env.yaml` — они перебивают
   API-level версии и путают читателя.
3. **Читаемые имена probe-файлов (P3).** `{organization_id_or_slug}` и
   `{project_id_or_slug}` сейчас оба → `by-id`. Сохранять имя
   placeholder'а: `by-org`, `by-proj`, `by-replay`.
4. **Авто-ротация digest'ов и дефолтная `triage/` (P6, P7).**
   Output-флаги, которые перезаписывают предыдущий артефакт без
   warning'а — баг. Дефолтный путь `<workspace>/triage/<api>/<run>/`
   плюс auto-suffix `-vN` или `--output-pattern '%Y%m%d-%H%M.md'`.
5. **Body-cap для HTML и case-study (P8).** Расширение TASK-141:
   `--report-body-cap` для HTML-export'а тоже, не только case-study.
6. **DRY в probe-suites (P4).** Опционально: `extends:` в YAML или
   общий `_template.yaml` — 3.7 MB → ~700 KB на том же контенте.
7. **Не создавать пустые `--emit-tests/` (P5).** Если эмитить нечего,
   не создавать каталог; либо положить EMPTY-файл с пояснением.

### Не покрывает

- Качество тестов и probe-recall (m-1, m-8).
- UI/serve (m-7).
- Новые probe-классы (m-5).

### Точка входа для агента

При старте задач — сначала прочитать
[feedback-original.md](../notes/m-9-workspace-hygiene/feedback-original.md),
секцию «Проблемы процесса создания файлов» (P1–P10): там полные
репро-кейсы с конкретными путями и размерами.
