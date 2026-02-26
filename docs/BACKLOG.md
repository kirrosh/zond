# BACKLOG — Приоритеты и милестоуны

Следующие шаги развития APITOOL после M1-M11.

---

## Tier 1 — Публичный релиз

### 1. README.md

- Installation instructions (бинарник, Bun dev mode)
- Quick start: generate → run → serve
- Примеры YAML-тестов, скриншоты WebUI
- Бейджи (CI, license, version)

### 2. CI pipeline (GitHub Actions)

- Lint + typecheck (`bun run check`)
- Тесты (`bun test`)
- Multi-platform build: `linux-x64`, `darwin-arm64`, `win-x64`

### 3. GitHub Release

- Tag → build → publish бинарники для 3 платформ
- Changelog из коммитов

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
| Integration тесты для JSONPlaceholder нестабильны (внешний API) | `tests/integration/` | Medium |
| Explorer: response body schema не показывает вложенные объекты | `explorer.ts` | Low |
| `describe.ts`, `init.ts`, `testcases.ts` — упоминались в ранних версиях документации, не реализованы | — | Info |

---

## Милестоуны

### M12: Public Release Package

- README.md с бейджами, фичами, quick start, примерами, скриншотами
- GitHub Actions CI: typecheck + test + compile (linux-x64, darwin-arm64, win-x64)
- Release workflow: tag → build → publish
- **Приоритет:** без дистрибуции инструмент невидим

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
M12 (Release) → M13 (Environments) → M14 (DX) → M15 (WebSocket) → M16 (Analytics)
```
