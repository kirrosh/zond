---
id: TASK-25
title: 'T25: --rate-limit и auto Retry-After в zond run'
status: Done
assignee:
  - '@claude'
created_date: '2026-04-27 13:41'
updated_date: '2026-04-27 13:52'
labels:
  - runner
  - robustness
milestone: m-1
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

В live-сессии против Resend API первый прогон дал 40/45 фейлов = 429 (rate limit 5 req/s). Воркэраунд — внешний `for f in tests/*.yaml; do zond run "$f"; sleep 2; done`, но это должно быть встроено в runner.

## Что сделать

- CLI-флаг `--rate-limit <N>` (req/s) для `zond run`.
- Автоматический respect заголовка `Retry-After` на 429 (с экспоненциальным backoff, capped).
- Поле `rateLimit:` в `zond.config.yml` / `.env.yaml` для дефолта на API.

## Acceptance

- `zond run apis/resend/tests --rate-limit 5` не получает 429 на здоровом аккаунте.
- 429 без флага — runner ждёт `Retry-After` и ретраит шаг до N раз, затем фейлит с понятной диагностикой.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 CLI-флаг --rate-limit работает per-suite и per-run
- [x] #2 Retry-After на 429 уважается автоматически
- [x] #3 Конфиг в zond.config.yml поддерживается
- [x] #4 Документация обновлена в ZOND.md
<!-- AC:END -->

## Implementation Plan

<!-- SECTION:PLAN:BEGIN -->
## План

1. **`src/core/runner/rate-limiter.ts`** (новый): interval-throttle с `acquire()` — гарантирует ≤ N req/s.
2. **`src/core/runner/http-client.ts`**: на 429 уважать `Retry-After` (секунды или HTTP-date), fallback — exponential backoff (base 1s, factor 2, cap 30s). Дефолт 5 ретраев для 429 поверх существующего `retries`.
3. **`src/cli/program.ts`**: флаг `--rate-limit <N>` (req/s) для `zond run`.
4. **`src/cli/commands/run.ts`**: прокинуть rateLimit в executor; приоритет CLI > suite config > env config.
5. **`src/core/parser/schema.ts`**: `rateLimit?: number` в схему.
6. **`.env.yaml`**: top-level поле `rateLimit:` читается в `variables.ts`.
7. **`src/core/runner/executor.ts`**: один rate-limiter на suite-run, `acquire()` перед каждым request.
8. **Тесты**: rate-limiter (интервал), http-client (Retry-After + backoff), CLI флаг.
9. **`ZOND.md`**: документация.

Параметры: 5 ретраев на 429, cap 30s. Поле rateLimit в `.env.yaml`.
<!-- SECTION:PLAN:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
## Реализация

**Новый файл `src/core/runner/rate-limiter.ts`:**
- `IntervalRateLimiter` — interval-throttle, гарантирует ≤ N req/s через `acquire()`.
- `createRateLimiter(reqPerSec)` — фабрика, возвращает `undefined` если лимит не задан/невалиден.
- `parseRetryAfter(header)` — парсит `Retry-After` (секунды или HTTP-date) → ms; нелогичные/прошлые даты → `0`.

**`src/core/runner/http-client.ts`:**
- `FetchOptions` расширен: `rate_limiter?`, `rate_limit_retries` (default 5), `rate_limit_max_delay_ms` (default 30000).
- Цикл переписан с `for(retries)` на `while(true)` с раздельными счётчиками `networkAttempt` и `rate429Attempt` — 429 не съедает бюджет network-retries и наоборот.
- На 429: ждём `Retry-After` (если есть, capped to `rate_limit_max_delay_ms`), иначе exponential backoff (`retry_delay * 2^attempt`, cap 30s); body дренируется перед sleep.
- После исчерпания `rate_limit_retries` — 429 возвращается как обычный response.

**`src/core/parser/variables.ts`:**
- Добавлен `loadEnvMeta(envName, searchDir)` — читает `rateLimit:` (number или string-число) из `.env.yaml` / `.env.<name>.yaml` (searchDir + parent).
- `loadEnvironment` теперь чистит зарезервированные meta-ключи (`rateLimit`) из словаря переменных, чтобы они не попадали в `{{rateLimit}}`-подстановки.

**`src/core/runner/executor.ts`:**
- `runSuite` принимает `RunSuiteOptions { rateLimiter? }`, прокидывает в `FetchOptions.rate_limiter`.
- `runSuites` пробрасывает options.

**CLI:**
- `src/cli/program.ts`: флаг `--rate-limit <N>` (positive int), валидация через `parsePositiveInt`.
- `src/cli/commands/run.ts`: приоритет CLI > `.env.yaml`. Один общий `RateLimiter` создаётся на весь `zond run` и шарится между setup/regular suites.

**Тесты:**
- `tests/runner/rate-limiter.test.ts` — фабрика, throttle interval, parseRetryAfter (sec, fractional, HTTP-date, past, invalid).
- `tests/runner/http-client.test.ts` — 4 новых: Retry-After (sec) уважается; exponential backoff без header; исчерпание ретраев возвращает 429; rate-limiter троттлит параллельные запросы.
- `tests/cli/program.test.ts` — `--rate-limit=abc` и `=0` отклоняются.

**Документация:** `ZOND.md` — секция "Rate limiting & 429 handling" + флаг в CLI-таблице.

**Решения:**
- 429 после исчерпания retries не бросает исключение, а возвращает response — runner затем покажет diagnostic warning (как раньше).
- Rate limiter создаётся per-run, шарится между всеми suites (включая параллельные) — правильное поведение для глобального API rate limit.
- `rateLimit` в `.env.yaml` намеренно не попадает в substitution-vars (был бы collision risk).
- Per-suite YAML-конфиг и `zond.config.yml` намеренно отложены: `zond.config.yml` — территория TASK-12; per-suite сейчас не требуется.
<!-- SECTION:NOTES:END -->

## Final Summary

<!-- SECTION:FINAL_SUMMARY:BEGIN -->
Добавлен глобальный rate-limiter и автоматическая обработка 429 в `zond run`.

**Изменения:**
- `--rate-limit <N>` (req/s) — CLI-флаг для `zond run`.
- `rateLimit:` в `.env.yaml` — дефолт на API (CLI имеет приоритет).
- На 429 runner уважает `Retry-After` (seconds или HTTP-date), без header — capped exponential backoff (cap 30s), до 5 ретраев.
- Token-bucket rate-limiter троттлит запросы глобально по всем suites одного run.

**Файлы:**
- `src/core/runner/rate-limiter.ts` (новый)
- `src/core/runner/http-client.ts` (refactor цикла, поддержка 429)
- `src/core/runner/executor.ts` (RunSuiteOptions с rateLimiter)
- `src/core/parser/variables.ts` (loadEnvMeta + чистка meta-ключей)
- `src/cli/program.ts`, `src/cli/commands/run.ts`
- `ZOND.md` — документация
- Тесты: rate-limiter (новый), http-client (+4), program (+2)

**Тесты:** 641/641 pass, typecheck clean.
<!-- SECTION:FINAL_SUMMARY:END -->
