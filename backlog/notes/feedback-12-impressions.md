# Feedback-12 — общие впечатления (Sentry, 12 раундов)

Saved 2026-05-08 from feedback-loop сессии (sentry, 89% coverage, 30+ backend tickets).

## Что zond делает хорошо

- Артефакт-first архитектура (.api-catalog/.api-resources/.api-fixtures) — отделение raw spec от обзорных YAML.
- Probes как класс (validation/methods/mass-assignment/security) — 264 сьюта за 2с, поймали 107 5xx.
- `generate --explain` — единственный способ понять что войдёт в CRUD chain.
- `--validate-schema --spec` — contract drift почти бесплатно (7 расхождений у Sentry).
- Fail-fast parser после TASK-244/247.
- Coverage-overhaul: Run #N тег + «pass + 2xx = covered».

## Что съедает время (главные узкие места)

1. **Discover работает только когда .env уже наполовину заполнен** — узкое место первых 30 минут. → TASK-261 (bootstrap).
2. **Probes мутируют live state** — после mass-assignment fixtures разваливаются. → TASK-259, TASK-264 (--isolated).
3. **Coverage не делает union** — реальные 89% видны только через jq. → TASK-255.
4. **CRUD chain ломается на capture-bug** — единственный по-настоящему критичный баг, мешающий 89%→95%+. → TASK-256.
5. **Generator не читает pattern: / enum: / format: / example:** — slug/platform/email падают на пустом месте. → TASK-252/253 (done) + TASK-263 (format/example).

## Идеи QoL

- `zond run --watch` — пересобирает + перезапускает изменённые сьюты.
- `zond db diagnose --latest` без аргумента → последний failing run.
- `zond run --quiet` — глушить «Next steps» (60+ строк шума на batch-генерации, ср. feedback-09#F3).
- `zond clean --probes-only --force` — уточнить семантику (--probes есть, но без --all всё равно сносит tests/).
- `zond doctor --fix` — авто-наполнить пустые fixtures через discover + create seed-resources при `--seed`.

## Workflow-level

- `zond audit --api <name>` — single command full pipeline (bootstrap→discover→generate→probe-validation→probe-methods→run→coverage union→audit-report.html). Сейчас 8-10 ручных команд = setup-ralph-loop pipeline. → TASK-262.
- `zond ci init --gh` — расширить scaffolding `.github/workflows/zond.yml`.
- `zond serve --open` — поднять UI dashboard с live-graph покрытия и run-history (сейчас не запускается у пользователя). → TASK-268.

## Documentation / discovery

- `zond --help`: 30 команд без grouping → группировать setup/generate/run/probe/analyze/report. → TASK-267.
- Cookbook на конкретных API (Sentry/Stripe/Petstore): «3 команды от пустоты до 80%».
- `zond reference --field slug` или явный help-блок про `$randomSlug`/`$randomEmail`/`$randomUrl`.

## 3 главных рычага (по версии тестера)

1. `zond bootstrap --api X` (one-shot setup) — разблокирует первые 30 минут любого нового workspace. (TASK-261)
2. Починка capture в JSON-envelope (feedback-07#F2 / 12#F2) — 89% → 95%+. (TASK-256)
3. Generator с pattern/enum/example awareness — ещё 10-15% endpoints. (TASK-252/253 done + TASK-263)

После этих трёх workflow для нового API:
```
zond add api X --spec <url>
zond bootstrap --api X --seed
zond audit --api X
open audit-report.html
```
4 команды, 5 минут, 90% coverage. Сейчас тот же путь = 3-4 часа и 10+ итераций.
