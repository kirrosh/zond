---
id: m-19
title: "structural-refactor-and-hygiene"
---

## Description

Тематический рефакторинг после m-15/m-16/m-17, частично блокирующий m-18.
Источник — `strategy/refactor-plan.md`. Цель: закрыть остаточный
архитектурный долг, который lessons.md выявил, прежде чем m-18 (рецепты
quicktype/mitmproxy/sentry-sdk/interactsh) налепит новые ad-hoc слоты.

Совместимость можно ломать — никаких deprecation warnings, alias'ов,
backwards-compat shim'ов. Прямые drop'ы устаревшего API.

## Источники

- `strategy/refactor-plan.md` — план целиком, 8 блоков с приоритетами.
- `strategy/lessons.md` — root-cause анализ багов m-15/16/17 fb-loop'а.
- `strategy/strategy.md` §5 «Принципы (зацементированы m-15..m-17)».

## Цели майлстоуна

### Блокеры для m-18 (делаются первыми)

**A. Reporter slot — типизированный канал output'а** (lesson §E).
Закрывает 7 багов о `--report`/`--output`/`--json` расхождениях и
предотвращает повторение в m-18 рецептах.

1. `core/output/` модуль + `OutputSpec<Payload>` interface.
2. Миграция `run.ts` — `--report-out` drop, заменяется `--output`.
3. Миграция `checks.ts` — inline `--report` парсер удаляется.
4. Миграция probe-семейства — единый parser через OutputSpec.
5. Build-time покрытие: каждая `--json` команда декларирует `OutputSpec`
   с envelope schema (расширение ARV-57).

**B. Skill regression tests** (lesson §C).
12 SD-finding'ов m-15..m-17 закрылись точечно; нужна сетка.

6. `tests/contracts/skill-examples.test.ts` — парсит code-block'и из
   `init/templates/skills/*.md`, исполняет на synthetic spec, проверяет
   что флаги/опции существуют и команда не падает с EUSAGE.

**C. Layered spec model** (lesson §A precaution для m-18).
Предусматривает quicktype-derived и mitmproxy-derived layer'ы spec'а.

7. `core/spec/layers.ts` — `SpecLayer` interface, `composeSpec()`,
   provenance map. Миграция `upstream` + `user-extension` (`.api-resources.local.yaml`)
   через единый интерфейс.

### Параллельно с m-18

**D. Anti-FP registry** (lesson §F).

8. `core/anti-fp/` + `FpRule` interface + registry.
9. Миграция `checks/_anti_fp.ts` правил.
10. Миграция inline FP-match из `mass-assignment-probe.ts`.
11. Миграция inline FP-match из `security-probe.ts`.

**E. DB migration runner** (предусмотрительность для m-19+/knowledge-base).

12. `src/db/migrations/` каталог + `src/db/migrate.ts` runner.
    Применяет недостающие миграции при первом открытии `zond.db`.
    Перенос ARV-55 (`run_kind`) в `0001_run_kind.sql`.

**F. fb-loop CI nightly** (lesson §D).

13. GH Actions workflow: `zond audit --api sentry` nightly, складывает
    JSON-артефакт, diff'ит с baseline. Alert на новые HIGH-finding'и
    zond-side (не Sentry-side).

### Гигиена (любое время)

**G. Drop устаревших aliases.**

14. Удалить `commands/probe-mass-assignment.ts`, `probe-security.ts`,
    `probe-static.ts` — top-level дубликаты подкоманд `probe *`.
15. Проверить `commands/discover.ts`, `bootstrap.ts` — если subsumed
    `prepare-fixtures`, drop. Без alias.

**H. Cleanup.**

16. Fix typecheck errors в `core/orphans/orphan-tracker.ts`.
17. `bun run knip` pass — drop unused exports / unused files.

## Не покрывает

- **`zond agent-loop --target <repo>`** публичная команда — m-19+.
- **`zond verify --since main`** — depend on knowledge base, m-19+.
- **Knowledge base / lifecycle / 3 тира** (vector-4) — самостоятельный
  milestone.
- **Skill auto-generation из CLI manifest'а** — самостоятельный milestone.
- **`zond fuzz` engine** — m-19+ vector-2 этап 2.

## Принципы

- **Ломать совместимость дозволено.** Никаких deprecation warnings,
  alias'ов под старые флаги, backwards-compat shim'ов. Сразу drop.
- **Один консумер — один слот.** Если паттерн скопирован ≥2 раз — вырезаем
  в общий модуль с первого касания.
- **Compile-time контракт > runtime check.** Любой shape, который мы
  валидируем — через TS interface + envelope schema, не через if-else.
- **Каждое FP-правило / output-format / spec-layer приходит с fixture-test'ом.**
  Регрессия не возвращается.
- **Никаких рефакторов вне рамки.** Если рефактор требует трогать
  knowledge-base / fuzz / verify-since — задача переносится в следующий
  milestone.

## Done-критерий

1. `grep -rn "if (opts.report\|opts.reportOut\|opts.ndjson)" src/cli/commands/`
   → 0 строк (всё съедено `runCommandWithOutput`).
2. `grep -rn "paid plan\|subscription gat" src/core/probe/` → 0 inline
   (всё в `core/anti-fp/rules/`).
3. `bun test tests/contracts/skill-examples.test.ts` — 100% green.
4. `composeSpec()` возвращает provenance map; `upstream` + `user-extension`
   проходят через него; готов к подключению quicktype/mitmproxy layer'ов.
5. `bun run typecheck` — 0 errors.
6. `bun run knip` — 0 unused exports / 0 unused files.
7. GH Actions nightly успешно прогоняется ≥3 ночи подряд, diff-baseline
   стабилен.
8. `ls src/cli/commands/probe-*.ts` → нет результатов (top-level aliases
   удалены).
9. `src/db/migrations/0001_*.sql` существует, applyMigrations() работает
   на чистой `zond.db`.

## Граф зависимостей

```
A. Reporter slot ──┬─→ блок run.ts
                   ├─→ блок checks.ts
                   └─→ блок probe.ts ─── блокирует m-18 (рецепты)

B. Skill regression tests — независим — блокирует m-18 (skill update)

C. Layered spec — независим — блокирует m-18 block A (quicktype)
                                       и block B (mitmproxy)

D. Anti-FP registry ──── параллельно m-18 block C (interactsh)

E. DB migrations ──── параллельно

F. fb-loop CI ──── параллельно, лучше до m-18

G. Drop aliases ──── любое время

H. Cleanup ──── после A/D (там удалится больше)
```

Критический путь блокеров: A + B + C → m-18.
