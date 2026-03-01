# BACKLOG — Приоритеты и милестоуны

Следующие шаги развития APITOOL после M1-M21.

---

## Tier 1 — Публичный релиз ✅

### 1. README.md ✅

- Installation instructions (бинарник, Bun dev mode)
- Quick start: add-api → ai-generate → run → serve
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
- Scope column (global / api:N) в списке окружений

### 5. `apitool init` — scaffolding проекта ✅

- Создание `tests/example.yaml`, `.env.dev.yaml`, `.mcp.json` (if Claude Code detected)
- Быстрый старт для новых пользователей

### 6. `apitool request --save`

- Сохранение ad-hoc запроса как YAML тест-кейс
- `apitool request GET /users --save tests/users.yaml`
- Автоматическая генерация assertions из ответа

### 7. Web UI: Add API form

- Форма "Add API" на дашборде (сейчас — только CLI `add-api`)
- Загрузка/URL спецификации из формы
- Визуальный env editor при создании

---

## Tier 3 — Улучшения

### 8. `serve --tests` flag

- Флаг `--tests` для указания пути к YAML-тестам, используется WebUI кнопкой "Run"

### 9. OAuth2/OIDC в Explorer

- Поддержка OAuth2 и OpenID Connect в Authorize Panel
- Redirect flow, popup окно, PKCE

### 10. Run comparison / diff между прогонами

- Сравнение двух прогонов: изменения статусов, duration delta
- Расширенная flaky-детекция с историей
- Trend длительности по отдельным тестам

### 11. Environment inheritance / profiles

- Наследование env: `staging` extends `default` + overrides
- Profile switching в WebUI

---

## Технический долг

| Задача | Файл(ы) | Приоритет |
|--------|---------|-----------|
| CI: integration тесты ✅ | `tests/integration/`, `.github/workflows/ci.yml` | Done |
| CI: typecheck (`tsc --noEmit`) ✅ | `tsconfig.json`, `.github/workflows/ci.yml` | Done |
| Explorer: response body schema не показывает вложенные объекты | `explorer.ts` | Low |
| MCP: `.mcp.json` содержит абсолютные пути — нужна поддержка относительных путей и `cwd` | `src/mcp/`, `.mcp.json` | Medium |
| Test isolation: `mock.module()` в 13 тестах загрязняет Bun module cache | `tests/` | Medium |
| Web UI: environments page — grouping by collection, Add API form | `src/web/routes/environments.ts` | Low |

---

## Милестоуны

### M12: Public Release Package ✅

- README.md с фичами, quick start, примерами, CLI reference
- MIT License, CHANGELOG.md
- GitHub Actions CI: тесты на push main/dev и PR
- Release workflow: tag → matrix build (3 OS) → tar.gz/zip → GitHub Releases

### M13: Environment Management в WebUI ✅

- CRUD routes: environments list/detail/create/update/delete
- Key-value editor для переменных
- Selector окружения при запуске тестов в коллекции

### M14: Self-Documented API + Incremental Generation + Dogfooding ✅

- API routes конвертированы на `@hono/zod-openapi`
- JSON API для Environments и Collections
- Инкрементальная генерация, coverage scanner
- Dogfooding: integration тесты используют apitool API

### M14.1: Разделение HTMX и JSON API routes ✅

- `/api/*` — только JSON (OpenAPI-documented)
- HTMX form-data handlers перенесены на HTML-пути

### M15: MCP Server — AI-agent интеграция ✅

- MCP сервер для AI-агентов (Claude Code, Cursor, Windsurf, Cline)
- 11 MCP tools: run_tests, validate_tests, list_collections, list_runs, get_run_results, list_environments, send_request, explore_api, manage_environment, diagnose_failure, coverage_analysis
- `executeRun()` — shared модуль

### M15.1: Install Script + `apitool init` ✅

- `install.sh` — one-liner установка бинарника
- `apitool init` — scaffolding нового проекта

### M16: Generate Wizard — Smart Generate + Safe Run + Auth ✅

- `--safe` флаг для CLI и MCP — запуск только GET-тестов
- `--auth-token`, `--env-name` флаги
- `loadEnvironment()` fallback на DB

### M19: Unified Capabilities ✅

- CLI: `request`, `envs`, `runs`, `coverage`
- MCP: 5 новых tools — `send_request`, `explore_api`, `manage_environment`, `diagnose_failure`, `coverage_analysis`
- Agent: 2 новых tools — `send_request`, `explore_api`

### M20: Post-M19 Improvements ✅

- DB singleton fix, README update
- `apitool doctor` — диагностика
- `apitool envs import/export`

### M21: Collection Architecture + Environment Scoping ✅

- `apitool add-api <name>` — явный флоу регистрации API
  - Создаёт `apis/<name>/tests/`, `.env.yaml`, запись в DB с `base_dir`
  - Валидация OpenAPI спеки, извлечение `base_url` из `servers[0]`
  - Scoped environment `default` в DB
- Флаг `--api <name>` для `run`, `ai-generate`, `coverage`, `envs`
  - Автоматический резолв путей через `findCollectionByNameOrId()`
- Environment scoping: `collection_id` в таблице environments
  - Global (collection_id IS NULL) + scoped (привязан к коллекции)
  - `resolveEnvironment()` — мерж global + scoped
  - Приоритет: файл > DB scoped > DB global > генераторы
- DB Schema V5: `base_dir` в collections, `collection_id` в environments
  - Уникальные индексы: `(name, collection_id)` + partial index для глобальных
  - Backfill `base_dir` = `dirname(test_path)` при миграции
- MCP `manage_environment` — `collectionName` param для scoping
- WebUI: scope column в списке окружений, сохранение scope при update

### Порядок

```
M12 (Release) ✅ → M13 (Environments) ✅ → M14 (Self-Doc API) ✅ → M14.1 (Route Split) ✅ → M15 (MCP Server) ✅ → M15.1 (Install + Init) ✅ → M16 (Generate Wizard) ✅ → M19 (Unified Capabilities) ✅ → M20 (Post-M19) ✅ → M21 (Collection Architecture) ✅
```
