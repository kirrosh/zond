# BACKLOG — Отложенные модули и задачи

Функциональность, запланированная в APITOOL.md, но не реализованная в текущих итерациях.

---

## M3: Generator — незавершённые уровни

### Уровень 2: CRUD-цепочки (`src/core/generator/crud.ts`)

- **Что:** Автоматическое распознавание CRUD-паттернов (POST + GET + PUT + DELETE на одном ресурсе)
- **Зачем:** Генерация связанных тестов с captures (POST создаёт → GET проверяет → DELETE удаляет)
- **Статус:** Файл `crud.ts` указан в APITOOL.md, но не реализован. Skeleton-уровень (Level 1) работает.

### Уровень 3: Текстовые тест-кейсы (`src/core/generator/testcases.ts`)

- **Что:** Генерация Markdown тест-кейсов из OpenAPI (TC-001, TC-002...) с приоритетами
- **Зачем:** Документация для QA-команды, покрытие негативных сценариев
- **Статус:** Не начат. CLI-команда `apitool describe` запланирована, но не реализована.

---

## M7: CLI — недостающие команды

Ye

### `apitool describe`

- **Что:** Генерация Markdown тест-кейсов из OpenAPI спеки
- **Флаги:** `--from <spec>`, `--output <file>`
- **Зависит от:** Generator Level 3

### `apitool init`

- **Что:** Создание структуры проекта (каталоги, пример YAML, .env.yaml шаблон)
- **Зачем:** Быстрый старт для новых пользователей

### `apitool serve --tests <dir>`

- **Что:** Флаг `--tests` для указания пути к YAML-тестам, запуск через WebUI кнопку "Run"
- **Статус:** Флаг принимается CLI, но не передаётся в WebUI. POST /api/run принимает path в body.

---

## M6: WebUI — улучшения

### Pass Rate Trend график

- **Что:** Визуальный график pass rate по прогонам (SVG или Canvas)
- **Статус:** SQL-запрос `getPassRateTrend()` готов, данные есть. Нет визуализации.

### Фильтрация и поиск

- **Что:** Фильтр прогонов по environment, дате, статусу; поиск по имени теста
- **Где:** GET /runs с query-параметрами

### Export результатов

- **Что:** Скачивание JUnit XML / JSON отчёта из WebUI
- **Где:** Кнопка на странице `/runs/:id`

### WebSocket live updates

- **Что:** Прогресс выполнения тестов в реальном времени при POST /api/run
- **Сейчас:** Redirect на результат после завершения

---

## M8: Сборка и публикация

### `bun build --compile`

- **Что:** Компиляция в один бинарник (~50-80 MB)
- **Задачи:**
  - Проверить что static/style.css и HTMX вкомпилированы
  - Тестировать на Linux/macOS/Windows
  - CI pipeline (GitHub Actions)

### README.md

- **Что:** Публичная документация с примерами, GIF-демо, installation instructions
- **Зачем:** Для GitHub релиза

### GitHub Release

- **Что:** Автоматическая сборка бинарников для 3 платформ, публикация release
- **Зависит от:** bun compile + CI

---

## Технический долг

| Задача                                                          | Файл(ы)              | Приоритет |
| --------------------------------------------------------------- | -------------------- | --------- |
| `.gitignore` для `*.db`, `*.db-wal`, `*.db-shm`                 | `.gitignore`         | High      |
| Удалить `seed-demo.ts` или перенести в `scripts/`               | `seed-demo.ts`       | Low       |
| Integration тесты для JSONPlaceholder нестабильны (внешний API) | `tests/integration/` | Medium    |
| Explorer: response body schema не показывает вложенные объекты  | `explorer.ts`        | Low       |
| Dashboard: отсутствует визуальный graph для trend               | `dashboard.ts`       | Medium    |

---

## Порядок приоритетов

1. **M8: Сборка** — `bun compile`, проверить бинарник
2. **Generator Level 2 (CRUD)** — самая ценная фича генератора
3. **.gitignore + cleanup** — технический долг
4. **WebUI improvements** — график, фильтры, export
5. **Generator Level 3 + describe** — тест-кейсы в Markdown
6. **CLI init** — удобство для новых пользователей
