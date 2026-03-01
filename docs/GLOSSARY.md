# Тезаурус сущностей APITOOL

Определения всех доменных сущностей системы.

---

## Collection (Коллекция = один API)

Верхнеуровневая единица. Группирует тесты, окружения и спеку вокруг одного API.

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | INTEGER PK | Автоинкремент |
| `name` | TEXT | Уникальное имя API (e.g. `petstore`) |
| `base_dir` | TEXT | Корневая директория коллекции (e.g. `apis/petstore/`) |
| `test_path` | TEXT | Абсолютный путь к директории с тестами |
| `openapi_spec` | TEXT? | Путь или URL к OpenAPI спеке |
| `created_at` | TEXT | ISO 8601 |

**Создание:** `apitool add-api <name> [--spec <path>] [--dir <dir>]`

**Структура директорий (конвенция):**

```
apis/
  petstore/                  # base_dir
    openapi.yaml             # OpenAPI спека (опционально)
    .env.yaml                # Default environment
    .env.staging.yaml        # Дополнительные envs
    tests/                   # test_path — здесь живут сьюты
      smoke.yaml
      users/
        crud.yaml
        auth.yaml
```

---

## Suite (Тест-сьют)

YAML-файл с набором тестов. Содержит `name`, `base_url`, `headers`, `config`, массив `tests`.

**Хранение:** Только файл на диске. В DB — только `suite_name` как строка в таблице `results`. Файловая система — source of truth (git-friendly, редактируемые, портативные). `parseDirectory()` обнаруживает сьюты on demand.

**Ключевые поля:**

| Поле | Описание |
|------|----------|
| `name` | Имя сьюта (отображается в отчётах) |
| `base_url` | Базовый URL для всех тестов (поддерживает `{{base_url}}`) |
| `headers` | Общие заголовки (e.g. `Authorization`) |
| `config` | `timeout`, `retries`, `retry_delay`, `follow_redirects`, `verify_ssl` |
| `tests` | Массив TestStep |

---

## Test Step (Шаг теста)

Один HTTP-запрос внутри сьюта. Метод + путь + тело + assertions + captures.

| Поле | Описание |
|------|----------|
| `name` | Имя шага |
| `method` | HTTP-метод: GET, POST, PUT, PATCH, DELETE |
| `path` | URL-путь (поддерживает `{{переменные}}`) |
| `headers` | Заголовки запроса |
| `json` / `form` | Тело запроса |
| `query` | Query-параметры |
| `expect` | Ассерты: `status`, `body`, `headers`, `duration` |
| `capture` | Извлечение значений из ответа в переменные |

**DB результат:** таблица `results` — `suite_name`, `test_name`, `status`, `request_*`, `response_*`, `assertions` (JSON), `captures` (JSON).

---

## Run (Прогон)

Факт запуска тестов. Суммарная статистика, привязка к коллекции и окружению.

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | INTEGER PK | Автоинкремент |
| `started_at` | TEXT | ISO 8601 |
| `finished_at` | TEXT? | ISO 8601 |
| `total` / `passed` / `failed` / `skipped` | INTEGER | Счётчики |
| `trigger` | TEXT | `manual`, `cli`, `webui`, `mcp` |
| `environment` | TEXT? | Имя использованного окружения |
| `duration_ms` | INTEGER? | Длительность прогона |
| `collection_id` | INTEGER? | FK → collections |

**Привязка к коллекции:** автоматическая через `findCollectionByTestPath()` при запуске.

---

## Environment (Окружение)

Именованный набор переменных (`{{base_url}}`, `{{token}}`).

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | INTEGER PK | Автоинкремент |
| `name` | TEXT | Имя окружения (e.g. `staging`, `default`) |
| `collection_id` | INTEGER? | FK → collections. NULL = глобальное |
| `variables` | TEXT (JSON) | `{ "base_url": "...", "token": "..." }` |

**Scoping:**
- `collection_id = NULL` → глобальный env (доступен всем коллекциям)
- `collection_id = <id>` → скоупленный env (только для этой коллекции)

**Приоритет резолва `--env staging` для коллекции X:**
1. Файл `.env.staging.yaml` в директории тестов → если есть, перезаписывает всё
2. DB: env `staging` с `collection_id = X.id` → scoped
3. DB: env `staging` с `collection_id = NULL` → global
4. Мерж: (3) база + (2) оверрайд + (1) оверрайд всего

**CLI:** `apitool envs set staging base_url=... --api petstore` → scoped env.

---

## Variable / Capture

Механизм передачи данных между шагами и окружениями.

**Источники переменных:**
- Environment (файл `.env.yaml` или DB)
- Captures из ответов предыдущих шагов
- Встроенные генераторы: `$uuid`, `$timestamp`, `$randomName`, `$randomEmail`, `$randomInt`, `$randomString`

**Подстановка:** `{{variable_name}}` — в path, headers, body, query, assertions.

Если вся строка — `{{var}}`, возвращается raw-значение (число остаётся числом). Если `{{var}}` внутри строки — конвертируется в string.

---

## AI Generation (AI-генерация)

Запись о факте AI-генерации тестов.

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | INTEGER PK | Автоинкремент |
| `collection_id` | INTEGER? | FK → collections |
| `prompt` | TEXT | Пользовательский промпт |
| `model` | TEXT | Имя модели (e.g. `gpt-4o`, `qwen3:4b`) |
| `provider` | TEXT | `ollama`, `openai`, `anthropic`, `custom` |
| `generated_yaml` | TEXT? | Результат генерации (YAML) |
| `output_path` | TEXT? | Путь к сохранённому файлу |
| `status` | TEXT | `success` / `error` |
| `prompt_tokens` / `completion_tokens` | INTEGER? | Token usage |
| `duration_ms` | INTEGER? | Длительность генерации |

**Архитектура:** LLM генерирует JSON → `serializeSuite()` конвертирует в валидный YAML.

---

## OpenAPI Spec (Спецификация API)

Описание API в формате OpenAPI 3.x. Используется для:
- **Explorer** — дерево API, Try it, authorize panel
- **Coverage** — сравнение спеки с тестами (`coverage_analysis`)
- **AI Generate** — контекст для LLM при генерации тестов
- **add-api** — извлечение `servers[0].url` как `base_url`

**Хранение:** путь или URL, привязан к коллекции (поле `openapi_spec`). Читается on demand через `readOpenApiSpec()`.

---

## Settings (Настройки)

Глобальные key-value настройки в таблице `settings`.

Используется для: `ai_provider`, `ai_model`, `ai_base_url`, `ai_api_key`.

---

## Chat Session (Сессия чата)

Контекст AI-чата (`apitool chat`). Хранит историю сообщений, провайдер и модель.

Таблицы: `chat_sessions`, `chat_messages`. Автосжатие через `context-manager.ts` при >20 сообщений.
