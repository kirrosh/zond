---
id: ARV-249
title: >-
  probe static: hangs/extreme slowness on large spec (10927 probes под
  rate-limit 30)
status: In Progress
assignee: []
created_date: '2026-05-15 05:42'
updated_date: '2026-05-15 06:09'
labels:
  - feedback-loop
  - api-github
  - m-16
  - perf
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Source: feedback round 05 (inline user note), finding F20.

## Реальная природа проблемы

Само `zond probe static --api github` (1183 endpoint → 10927 probe-кейсов) выполняется быстро — **~1.6 сек** на моей машине, см. `time zond probe static --api github --output /tmp/probe-249-test`. Висит **не генерация**, а последующий `zond run <output>` под `--rate-limit 30`:
- математический минимум: 10927 / 30 ≈ 364 сек = **>6 минут** чистого throughput,
- консоль молчит до самого summary — нет progress, нет ETA, нет `--max-requests` cap,
- пользователь не понимает, висит процесс или работает → SIGKILL.

Та же архитектурная дыра, что и в **ARV-227** (`checks run --phase coverage` extreme slowness — там есть NDJSON-стрим, но обычный `run` лишён даже его).

Что `probe static` **уже умеет**: `--max-per-endpoint <N>` (default 50). На GitHub-спеке среднее = ~9 probe/endpoint, в потолок никто не упирается — флаг не помогает.

## Дизайн фикса (три независимых среза)

### A. probe static: scale-warning блок после генерации (cheap, изолированно)
Когда `totalProbes ≥ 2000` — печатать после Summary блок:

```
⚠  Large probe set: 10927 probe(s) across 1183 endpoint(s).
   Estimated run time at common rate-limits:
     --rate-limit 10  → ~18m   --rate-limit 30  → ~6m   --rate-limit 60  → ~3m
   To sample: zond probe static --api github --max-per-endpoint 3 --output …
              (~3550 probe(s))
```

Чисто косметика + правильные ожидания. Не блокирует ничего.

### B. zond run: progress-reporter для долгих ранов
Периодическая строчка на **stderr** каждые `PROGRESS_INTERVAL_MS` (default 5000):

```
zond: [42s] suites 12/1183 (1%), steps 234/10927 (2%), ~30 req/s, ETA ~5m12s
```

- Активируется когда: `process.stderr.isTTY === true` **или** wall-time превысил `PROGRESS_START_MS` (30s).
- Подавляется флагами: `--quiet`, `--json` (json-envelope-режим), `--report ndjson` (NDJSON владеет stdout — нельзя смешивать).
- Источник данных: новый callback `onStepDone?: (step, totals) => void` в `RunSuiteOptions` (см. `src/core/runner/executor.ts:163`). Каждый завершённый шаг бьёт в общий аккумулятор `{ completedSteps, totalSteps, firstStartMs, lastTickMs }`. Timer в `run.ts` (см. строки 333-339) сэмплирует и пишет.
- ETA = `(totalSteps - completedSteps) / effectiveRps`, где `effectiveRps = completedSteps / elapsedSeconds`.
- `totalSteps` известен до старта — после `expandParameterize()` для всех suite (сумма step-counts). Можно прикинуть один проход по `suites`.

### C. zond run: `--max-requests <N>` hard-cap (общее с ARV-227)
- Атомарный счётчик-обёртка над rate-limiter (или отдельный gate в executor.ts перед `httpFetch`).
- При превышении: остальные шаги → `skip` с `reason: "max-requests-cap-reached"`, отчёт нормальный.
- В summary — отдельная строка: `Skipped 8923 step(s) due to --max-requests 2000 cap`.
- Помогает: (а) семплировать огромные probe-suite без переделки YAML, (б) ставить потолок на CI-таймбоксе.

### D. (опционально) probe static: `--max-total <N>` global cap
Сейчас `--max-per-endpoint` режет per-endpoint; нужен глобальный потолок. Детерминированный порядок (сортировка endpoint+probe-class+index). Полезно, но **B+C закрывают user-pain без этого** — можно отдельной задачей.

## Что менять (файлы)

- `src/cli/commands/probe/static.ts:182-211` — добавить scale-warning блок после печати `printSuccess` (порог 2000, формула ETA = totalProbes / rl).
- `src/core/runner/executor.ts:163-174` — расширить `RunSuiteOptions` на `onStepDone` + `maxRequests`.
- `src/core/runner/executor.ts:176-595` — в теле `runSuite` после каждого `pushStep` дёргать `onStepDone`; перед каждым fetch проверять глобальный счётчик и `pushStep(skip, …)` при превышении.
- `src/cli/commands/run.ts:333-339` (rate-limiter init) — рядом инициализировать progress-tracker; завести `setInterval` в основном `runCommand`; clearInterval в finally.
- `src/cli/commands/run.ts:886` — добавить `.option("--max-requests <N>", …, parsePositiveInt)`.
- `src/cli/commands/init/templates/skills/run.md` — задокументировать новые флаги и progress-поведение (см. CLAUDE.md feedback_update_skills_per_feature).
- Тесты: `tests/integration/run-progress.test.ts`, `tests/integration/run-max-requests.test.ts`.

## Acceptance Criteria
<!-- AC:BEGIN -->
1. `zond probe static --api github` печатает scale-warning блок с ETA-prognozами для `--rate-limit 10/30/60`, когда `totalProbes ≥ 2000`.
2. `zond run` на сьюте с ≥100 шагов и реальной задержкой пишет progress-строку в stderr каждые ~5s. Формат включает elapsed, completed/total steps (с %), effective req/s, ETA.
3. Progress подавляется под `--quiet`, `--json`, `--report ndjson`. Тест: захватить stderr — там должно быть пусто (или только финальные warnings).
4. `zond run --max-requests <N>` гарантирует **строго ≤ N** реальных HTTP-вызовов. Остальные шаги в отчёте — `skipped` с `reason: "max-requests-cap-reached"`. Exit code как обычно (0/1 по failures).
5. Summary в конце добавляет строку про cap, если он сработал.
6. `apis/<name>/.zond` / NDJSON reporter не теряют формат (regression-тест существующих reporter-snapshot тестов).
7. Скилл `init/templates/skills/run.md` обновлён.

- [x] #1 probe static печатает scale-warning блок с ETA для --rate-limit 10/30/60, когда totalProbes >= 2000
- [ ] #2 zond run на сьюте с >=100 шагами выводит progress-строку в stderr каждые ~5s: elapsed, completed/total, %, effective req/s, ETA
- [ ] #3 progress подавляется под --quiet, --json, --report ndjson (stderr чистый)
- [x] #4 zond run --max-requests N делает строго <= N HTTP-вызовов; оставшиеся шаги skipped с reason max-requests-cap-reached
- [x] #5 summary добавляет строку про сработавший --max-requests cap
- [x] #6 existing reporter snapshot tests (console/json/ndjson/junit) остаются зелёными
- [x] #7 src/cli/commands/init/templates/skills/run.md обновлён под новые флаги и progress-поведение
<!-- AC:END -->

## Implementation Plan (порядок коммитов)

1. **commit-1** ARV-249a — probe static scale warning (изолированный, A). Тест: snapshot stdout для маленькой и большой спеки.
2. **commit-2** ARV-249b — `--max-requests` для `zond run` (C). Тест: суит на 5 шагов с `--max-requests 2` → 2 pass + 3 skip.
3. **commit-3** ARV-249c — progress-reporter для `zond run` (B). Тест-юнит на ETA-форматтер + интеграционный с mock-таймером.
4. После каждого коммита: `bun run build && cp ./dist/zond ~/.local/bin/zond` (см. feedback_install_global_zond).
5. Обновить `src/cli/commands/init/templates/skills/run.md`.

## Связи

- Blocks/related: **ARV-227** (`checks run --phase coverage` slowness) — должен переиспользовать `--max-requests` cap и progress-pattern. Закрывать первым ARV-249, затем подцепить ARV-227 как продолжение.
- Может породить отдельную low-priority задачу `--max-total` для probe static (срез D).

## Log

~/Projects/zond-test/.fb-loop/rounds/raw-05.log (partial до SIGKILL), fix-report-05.md строка 13.
<!-- SECTION:DESCRIPTION:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
См. Implementation Plan в Description. Три независимых коммита: A (probe static scale warning) → C (--max-requests) → B (progress reporter). Обязательная installation  после каждой сборки.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Реализованы slice A (probe static scale-warning), slice C (--max-requests cap) и slice B (progress reporter для stderr под TTY).

Файлы:
- src/core/util/format-eta.ts (новый): formatEta(seconds) для probe-static + progress.
- src/cli/commands/probe/static.ts: buildLargeProbeNotice() + emit warning после Summary когда totalProbes >= 2000.
- src/core/runner/executor.ts: RunSuiteOptions расширен на requestBudget + onStepDone; reserveRequest() gate перед каждым executeRequest (включая retry_until-attempts); MAX_REQUESTS_SKIP_REASON.
- src/core/runner/progress-tracker.ts (новый): ProgressTracker + formatProgressLine.
- src/cli/commands/run.ts: --max-requests <N> option, requestBudget в runOpts, ProgressTracker + setInterval (5s), стирание stderr-строки перед report.
- src/cli/commands/init/templates/skills/zond.md: документация про progress, --max-requests, scale-warning.

Тесты (всего +21, общий пакет 2109 pass / 0 fail):
- tests/runner/progress-tracker.test.ts (10 test)
- tests/runner/max-requests.test.ts (3 test)
- tests/runner/probe-static-scale-notice.test.ts (4 test)

AC #2 / #3 — прогрессбар проверен вручную в TTY; авто-тест на TTY-режим CLI требует отдельного pty-харнеса и оставлен на будущее (см. tests/runner/progress-tracker.test.ts покрывает ядро трекера + formatter).
<!-- SECTION:NOTES:END -->
