---
id: m-12
title: "test-suite-quality"
---

## Description

После аудита 96 тест-файлов (1072 теста, см. `tests/AUDIT.md`, commit
`f956de4`) выявлены три класса проблем:

1. **Дублирование test-helper кода** — `ep()`, `makeStep`,
   `suppressOutput`, `mockFetchResponses`, `tmpDb`, `tmp-workspace+chdir`
   копипастятся в десятках файлов (~820 потенциально удалимых строк).
2. **Слабые/хрупкие тесты** — title не соответствует ассерту
   (`auth header injected from vars` не проверяет headers,
   `--timeout overrides suite config` не вызывает таймаут,
   `defaults output to current directory` передаёт явный output);
   spawn реального процесса там, где достаточно прямого импорта
   (cli-smoke, internal-error, completions, doctor — суммарно ~20
   ненужных bun-стартов на каждый прогон).
3. **Пробелы покрытия** — нет тестов на `src/core/runner/send-request.ts`
   (136 строк), `auth-path.ts`, `networkBackoffMs`; слабое покрытие
   `preflight-vars`, `transforms`, `expr-eval` строкового сравнения,
   `schema-validator` (oneOf/anyOf/allOf, additionalProperties, pattern,
   path-specificity — там же латентный баг).

Майлстоун — **только про качество тестов**, без новых пользовательских
фич и без правок production-логики (кроме одного бага в
schema-validator path-specificity, обнаруженного аудитом).

## Цели майлстоуна

### A. Shared helpers (фундамент)

1. `tests/_helpers/endpoints.ts` — общий `ep()`/`postEp()` (9 копий).
2. `tests/_helpers/output.ts` — `captureOutput()` (17 копий).
3. `tests/_helpers/{tmp-db,fetch-mock,workspace,reporter-fixtures}.ts` —
   tmpDb, mockFetch{Sequence,Ok,Router}, makeWorkspace, makeStep/Result.

### B. Drop redundancy / fix hygiene

4. CLI smoke spawn diet — `cli-smoke`, `internal-error`, `completions`.
5. `doctor.test.ts` — 8 spawn'ов → in-process.
6. `serve.test.ts` — handle leak: `serveCommand` должен возвращать `Bun.Server`.
7. `executor.test.ts` — двойной afterEach, misplaced multipart, throw-on-leak в `mockFetchResponses`.

### C. Strengthen weak tests

8. CLI слабые: `--timeout`, `catalog defaults`, `request action`, `update` happy-path.
9. Probe слабые: `auth header injected`, `restore failure` разделить, `formatDigestMarkdown` через literal verdict.

### D. Coverage gaps (runner)

10. `tests/runner/send-request.test.ts` — новый.
11. `tests/runner/auth-path.test.ts` + `networkBackoffMs` direct.
12. `preflight-vars` — расширить.
13. `executor.ts` ветви: timeout-abort, for_each×parameterize, retry_until body-condition, multipart file.
14. `transforms` edges + `expr-eval` лексикографика.
15. `schema-validator`: композиция + **fix latent bug** (concrete `/users/me` теряется vs `/users/{id}` из-за `endpoints.find`).

### E. Probe split + missed branches

16. `security-probe.test.ts` (872 строки) → 3 файла + `_helpers/state-machine.ts`.
17. Cover `open-redirect` end-to-end, `inconclusive` rollup, `negative-probe` `in:"header"|"cookie"`, multi-`{x}` paths.

## Не покрывает

- Новые probe-классы или security-фичи (вне scope).
- UI/e2e Playwright — отдельный трек.
- Переход на другой test-runner.

## Принципы

- Каждая задача — отдельный коммит `TASK-<N>: <subject>`.
- TASK-192 (helpers/endpoints) и TASK-193 (helpers/output) — **сначала**;
  они разблокируют split (TASK-206) и большинство dedupe-задач.
- Любая правка production-кода (`serveCommand` API, schema-validator
  path-specificity) выделяется в отдельный коммит и обязана быть
  back-compat для CLI-пользователей.
- Total expected: ~820 строк тестового кода удалено; +50-70 новых
  тест-кейсов покрытия; 1 латентный баг закрыт.
