# BACKLOG — Приоритеты и милестоуны

Следующие шаги развития APITOOL после M1-M12.

---

## Tier 1 — Публичный релиз ✅

### 1. README.md ✅

- Installation instructions (бинарник, Bun dev mode)
- Quick start: generate → run → serve
- Примеры YAML-тестов, CLI reference
- Лицензия MIT

### 2. CI pipeline (GitHub Actions) ✅

- Тесты (`bun test`) на push в main/dev и PR
- Typecheck (`tsc --noEmit`) в CI
- Multi-platform build: `linux-x64`, `darwin-arm64`, `win-x64`
- Integration тесты (dogfooding) в CI

### 3. GitHub Release ✅

- Tag `v*` → matrix build на 3 OS → tar.gz/zip → GitHub Releases
- CHANGELOG.md для v0.1.0
- Branching flow: dev → PR → main → tag → release

---

## Tier 2 — Ценные фичи

### 4. Environment management в WebUI ✅

- CRUD routes: `GET /environments`, `POST /environments`, `PUT /environments/:id`, `DELETE /environments/:id`
- Key-value editor для переменных
- Selector окружения при запуске тестов в WebUI
- Runs filter объединяет определённые environments + из истории прогонов

### 5. `apitool init` — scaffolding проекта ✅

- Создание `tests/example.yaml`, `.env.dev.yaml`, `.mcp.json` (if Claude Code detected)
- Быстрый старт для новых пользователей

### 6. WebSocket live updates

- Прогресс выполнения тестов в реальном времени при POST /api/run
- Bun native WebSocket + Hono upgrade
- Runner events: `{ suite, step, status, duration }`
- Прогресс-бар в WebUI

---

## Tier 3 — Улучшения

### 7. Generator Level 3 + `apitool describe`

- Генерация Markdown тест-кейсов из OpenAPI (TC-001, TC-002...)
- CLI-команда `apitool describe --from <spec> --output <file>`
- Приоритеты, негативные сценарии

### 8. `serve --tests` flag

- Флаг `--tests` для указания пути к YAML-тестам, используется WebUI кнопкой "Run"
- Флаг не реализован — отсутствует и в CLI, и в WebUI

### 9. OAuth2/OIDC в Explorer

- Поддержка OAuth2 и OpenID Connect в Authorize Panel
- Redirect flow, popup окно, PKCE

### 10. Run comparison / diff между прогонами

- Сравнение двух прогонов: изменения статусов, duration delta
- Расширенная flaky-детекция с историей
- Trend длительности по отдельным тестам

---

## Технический долг

| Задача | Файл(ы) | Приоритет |
|--------|---------|-----------|
| CI: integration тесты (crud-chain, auth-flow) ✅ | `tests/integration/`, `.github/workflows/ci.yml` | Done |
| CI: typecheck (`tsc --noEmit`) ✅ | `tsconfig.json`, `.github/workflows/ci.yml` | Done |
| Explorer: response body schema не показывает вложенные объекты | `explorer.ts` | Low |
| `describe.ts`, `init.ts`, `testcases.ts` — упоминались в ранних версиях документации, не реализованы | — | Info |
| `tests/web/environments.test.ts` — исправлено в M14.1 (HTMX routes отделены от JSON API) | `tests/web/environments.test.ts` | Done |
| `apitool init` — генерация `.mcp.json` с конфигом MCP-сервера для новых проектов ✅ | `src/cli/commands/init.ts` | Done |
| MCP: `.mcp.json` содержит абсолютные пути — нужна поддержка относительных путей и `cwd` | `src/mcp/`, `.mcp.json` | Medium |

---

## Милестоуны

### M12: Public Release Package ✅

- README.md с фичами, quick start, примерами, CLI reference
- MIT License, CHANGELOG.md
- GitHub Actions CI: тесты на push main/dev и PR
- Release workflow: tag → matrix build (3 OS) → tar.gz/zip → GitHub Releases
- Branching flow: dev → main → tag
- Первый релиз: v0.1.0

### M13: Environment Management в WebUI ✅

- CRUD routes: `GET /environments`, `GET /environments/:id`, `POST /environments`, `PUT /environments/:id`, `DELETE /environments/:id`
- Key-value editor для переменных (добавление/удаление строк)
- Selector окружения при запуске тестов в коллекции
- Runs filter: объединение `listEnvironments()` + `getDistinctEnvironments()`
- DB queries: `getEnvironmentById()`, `deleteEnvironment()`, `listEnvironmentRecords()`
- Навигация: ссылка "Environments" в layout

### M14: Self-Documented API + Incremental Generation + Dogfooding ✅

- API routes конвертированы на `@hono/zod-openapi` — автогенерация OpenAPI спеки
- `GET /api/openapi.json` — apitool отдаёт свою OpenAPI спеку
- JSON API для Environments и Collections (GET list, GET by ID, POST, PUT, DELETE)
- Инкрементальная генерация: `apitool generate` пропускает уже покрытые эндпоинты
- `writeSuites()` не перезаписывает существующие файлы
- Coverage scanner: `scanCoveredEndpoints()`, `filterUncoveredEndpoints()`
- Dogfooding: integration тесты используют apitool API вместо test-server
- CI: `tests/integration/crud-chain.test.ts` и `auth-flow.test.ts` в pipeline
- Генератор: поддержка `additionalProperties` (Record-типы) в `data-factory.ts`
- Удалён `test-server/` — auth-flow тест переписан с inline-сервером
- CI: typecheck (`tsc --noEmit`) включён в pipeline
- Исправлены ошибки типов в `schemas.ts`, `api.ts`

### M14.1: Разделение HTMX и JSON API routes ✅

- `/api/*` — только JSON (OpenAPI-documented)
- HTMX form-data handlers перенесены на HTML-пути (`/environments`, `/collections`, `/run`)
- Убраны хрупкие гейты (`if (content-type includes json) return next()`, `if (HX-Request) return next()`)
- Тесты обновлены: URL и заголовки соответствуют новым путям

### M15: MCP Server — AI-agent интеграция ✅

- MCP (Model Context Protocol) сервер для AI-агентов (Claude Code, Cursor, Windsurf, Cline)
- `apitool mcp` — stdio transport, `--db` flag для кастомного пути к БД
- 7 MCP tools: `run_tests`, `validate_tests`, `generate_tests`, `list_collections`, `list_runs`, `get_run_results`, `list_environments`
- Извлечён `executeRun()` в shared модуль `src/core/runner/execute-run.ts`
- `trigger: "mcp"` в DB runs для отличия MCP-запусков в дашборде
- Первый API-testing инструмент с нативной поддержкой AI-агентов

### M15.1: Install Script + `apitool init` ✅

- `install.sh` — one-liner установка бинарника через curl | sh
- `apitool init` — scaffolding нового проекта (tests/example.yaml, .env.dev.yaml, .mcp.json)
- Обнаружение Claude Code для автоматической генерации .mcp.json
- `--force` флаг для перезаписи существующих файлов
- README обновлён: install one-liner, init в Quick Start и CLI Reference

### M16: Generate Wizard — Smart Generate + Safe Run + Auth ✅

- `isRelativeUrl` / `sanitizeEnvName` хелперы в generator
- Relative base_url → `{{base_url}}` placeholder в генерируемых тестах
- `loadEnvironment()` fallback на DB если YAML не найден
- `--safe` флаг для CLI и MCP — запуск только GET-тестов
- `generate` автоматически создаёт environment в DB (base_url, auth vars)
- `--auth-token`, `--env-name`, `--no-wizard` флаги для generate
- MCP `generate_tests` создаёт коллекцию и environment в DB
- Интерактивный wizard при TTY (base URL, auth token, env name)
- Предупреждение о деструктивных тестах (POST/PUT/PATCH/DELETE)

### M17: WebSocket Live Updates

- Bun native WebSocket + Hono upgrade
- Runner events: `{ suite, step, status, duration }`
- Прогресс-бар в WebUI при запуске тестов
- **Приоритет:** UX — сейчас при долгих тестах UI "висит"

### M18: Test Analytics

- Diff между двумя прогонами (изменения статусов, duration delta)
- Расширенная flaky-детекция с историей
- Trend длительности по отдельным тестам

### Порядок

```
M12 (Release) ✅ → M13 (Environments) ✅ → M14 (Self-Doc API) ✅ → M14.1 (Route Split) ✅ → M15 (MCP Server) ✅ → M15.1 (Install + Init) ✅ → M16 (Generate Wizard) ✅ → M17 (WebSocket) → M18 (Analytics)
```
