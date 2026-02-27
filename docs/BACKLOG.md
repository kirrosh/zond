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
- Multi-platform build: `linux-x64`, `darwin-arm64`, `win-x64`
- Integration тесты исключены из CI (требуют test-server)

### 3. GitHub Release ✅

- Tag `v*` → matrix build на 3 OS → tar.gz/zip → GitHub Releases
- CHANGELOG.md для v0.1.0
- Branching flow: dev → PR → main → tag → release

---

## Tier 2 — Ценные фичи

### 4. Environment management в WebUI

- CRUD routes: `GET /environments`, `POST /api/environments`, `PUT`, `DELETE`
- Key-value editor для переменных
- Selector окружения при запуске тестов в WebUI
- Таблица `environments` уже в БД — нужны только routes + UI

### 5. `apitool init` — scaffolding проекта

- Создание `tests/`, `generated/`, `.env.yaml`, example test
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
| CI: integration тесты не запускаются — нужен автозапуск test-server | `tests/integration/`, `.github/workflows/ci.yml` | High |
| CI: typecheck (`tsc --noEmit`) отключён — test-server конфликтует с корневым tsconfig | `tsconfig.json`, `test-server/` | Medium |
| Explorer: response body schema не показывает вложенные объекты | `explorer.ts` | Low |
| `describe.ts`, `init.ts`, `testcases.ts` — упоминались в ранних версиях документации, не реализованы | — | Info |

### CI: Integration тесты с test-server

Сейчас integration тесты (`tests/integration/`) исключены из CI, т.к. требуют запущенный `test-server/`.

**Что нужно:**
- CI step: `cd test-server && bun install && bun run src/index.ts &` перед запуском тестов
- Дождаться готовности сервера (health check `GET /health`)
- Запустить `bun test tests/integration/` отдельным шагом
- Graceful shutdown после завершения

**Файлы:**
- `test-server/` — Hono + zod-openapi сервер с JWT auth, CRUD pets
- `tests/integration/crud-chain.test.ts` — CRUD цепочка
- `tests/integration/auth-flow.test.ts` — генерация тестов из спеки + прогон с авторизацией

### CI: Typecheck

`tsc --noEmit` отключён из CI т.к. `test-server/` имеет свои зависимости (`@hono/zod-openapi`, `jose`) которые не установлены в корневом `node_modules`. Несмотря на `include: ["src/**/*.ts", "tests/**/*.ts"]` в tsconfig, tsc на CI всё равно подхватывает файлы из `test-server/`.

**Варианты решения:**
- Установить зависимости test-server в CI перед typecheck
- Вынести test-server в отдельный репозиторий
- Добавить composite tsconfig с project references

---

## Милестоуны

### M12: Public Release Package ✅

- README.md с фичами, quick start, примерами, CLI reference
- MIT License, CHANGELOG.md
- GitHub Actions CI: тесты на push main/dev и PR
- Release workflow: tag → matrix build (3 OS) → tar.gz/zip → GitHub Releases
- Branching flow: dev → main → tag
- Первый релиз: v0.1.0

### M13: Environment Management в WebUI

- CRUD routes для `environments`
- Selector окружения при запуске тестов
- Key-value editor для переменных
- **Приоритет:** таблица уже в БД, нужны только routes + UI

### M14: Developer Experience

- `apitool init` — создание `tests/`, `generated/`, `.env.yaml`, example test
- `serve --tests` — передача пути к тестам в WebUI
- **Приоритет:** снижает порог входа для новых пользователей

### M15: WebSocket Live Updates

- Bun native WebSocket + Hono upgrade
- Runner events: `{ suite, step, status, duration }`
- Прогресс-бар в WebUI при запуске тестов
- **Приоритет:** UX — сейчас при долгих тестах UI "висит"

### M16: Test Analytics

- Diff между двумя прогонами (изменения статусов, duration delta)
- Расширенная flaky-детекция с историей
- Trend длительности по отдельным тестам

### Порядок

```
M12 (Release) ✅ → M13 (Environments) → M14 (DX) → M15 (WebSocket) → M16 (Analytics)
```
