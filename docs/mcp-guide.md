# MCP Agent Guide

Пошаговое руководство для AI-агента, работающего с apitool через MCP.

---

## Инструменты по группам

### Регистрация и настройка
| Инструмент | Когда использовать |
|------------|-------------------|
| `set_work_dir` | **Всегда первым** при npx MCP — привязывает сессию к директории проекта |
| `setup_api` | Один раз для каждого API — создаёт директории, сохраняет spec, формирует `.env.yaml` |

### Исследование API
| Инструмент | Когда использовать |
|------------|-------------------|
| `explore_api` | Быстрый обзор всех эндпоинтов (без схем) |
| `describe_endpoint` | Детали одного эндпоинта: параметры, схема запроса/ответа, security |
| `generate_tests_guide` | Полный гайд по генерации: spec + алгоритм написания тестов |
| `generate_missing_tests` | Гайд только для непокрытых эндпоинтов |

### Написание и валидация тестов
| Инструмент | Когда использовать |
|------------|-------------------|
| `save_test_suite` | Сохранить один YAML-файл с тестами |
| `save_test_suites` | Сохранить несколько файлов за один вызов |
| `validate_tests` | Проверить синтаксис YAML без запуска |

### Запуск и диагностика
| Инструмент | Когда использовать |
|------------|-------------------|
| `run_tests` | Запустить тесты, получить сводку |
| `send_request` | Проверить один запрос вручную (отладка токена, URL) |
| `query_db` | История запусков, детали, сравнение, диагностика падений |

### Покрытие и CI
| Инструмент | Когда использовать |
|------------|-------------------|
| `coverage_analysis` | Сколько эндпоинтов покрыто тестами |
| `ci_init` | Создать GitHub Actions / GitLab CI конфиг |
| `manage_server` | Запустить/остановить WebUI дашборд |

---

## Основной флоу с примерами

### Шаг 0. Привязка директории (только для npx MCP)

```
set_work_dir(workDir: "/home/user/myproject")
```

Без этого `apitool.db` создаётся в системной temp-директории и данные теряются между сессиями.

---

### Шаг 1. Регистрация API

```
setup_api(
  name: "petstore",
  specPath: "openapi.json",
  envVars: { "base_url": "https://api.example.com", "token": "abc123" }
)
```

Создаёт:
```
apis/petstore/
├── openapi.json      ← spec
├── tests/            ← здесь будут тесты
├── .env.yaml         ← переменные окружения
└── .gitignore        ← .env*.yaml исключены из git
```

---

### Шаг 2. Генерация тестов

**Всегда вызывайте `generate_tests_guide` перед написанием тестов.** Он возвращает полный spec + пошаговый алгоритм генерации YAML:

```
generate_tests_guide(specPath: "apis/petstore/openapi.json")
```

Для начала — только GET-эндпоинты (безопасно для продакшена):

```
generate_tests_guide(
  specPath: "apis/petstore/openapi.json",
  methodFilter: ["GET"]
)
```

Для непокрытых эндпоинтов:

```
generate_missing_tests(
  specPath: "apis/petstore/openapi.json",
  testsDir: "apis/petstore/tests/"
)
```

---

### Шаг 3. Сохранение тестов

```
save_test_suite(
  filePath: "apis/petstore/tests/pets-smoke.yaml",
  content: "..."
)
```

Или несколько файлов сразу:

```
save_test_suites(suites: [
  { filePath: "apis/petstore/tests/pets-smoke.yaml", content: "..." },
  { filePath: "apis/petstore/tests/pets-crud.yaml", content: "..." }
])
```

---

### Шаг 4. Запуск тестов

Безопасный запуск (только GET):

```
run_tests(testPath: "apis/petstore/tests/", safe: true)
```

Предварительный просмотр CRUD-запросов без отправки:

```
run_tests(testPath: "apis/petstore/tests/", tag: ["crud"], dryRun: true)
```

Запуск в конкретном окружении:

```
run_tests(testPath: "apis/petstore/tests/", envName: "staging")
```

С переопределением переменных:

```
run_tests(testPath: "apis/petstore/tests/", envVars: { "base_url": "http://localhost:3000" })
```

---

### Шаг 5. Диагностика и сравнение

Диагностика конкретного запуска (только упавшие шаги + что ответил сервер):

```
query_db(action: "diagnose_failure", runId: 42)
```

Сравнение двух запусков (регрессия):

```
query_db(action: "compare_runs", runId: 41, runIdB: 42)
```

---

### Шаг 6. CI/CD

```
ci_init()
```

Создаёт `.github/workflows/apitool.yml` (или GitLab CI) с расписанием, ручным триггером и отчётами. Подробнее: [docs/ci.md](ci.md).

---

## Как улучшить результат

### Используйте `generate_tests_guide` перед тестами
Никогда не пишите тесты по памяти или по частичному знанию API. Инструмент возвращает сжатый spec и точный алгоритм — агент пишет тесты правильно с первого раза.

### Начинайте с GET-запросов
```
generate_tests_guide(specPath: "...", methodFilter: ["GET"])
```
Smoke-тесты безопасны для продакшена. После их прохождения переходите к CRUD только с подтверждением пользователя.

### Изучайте сложные эндпоинты через `describe_endpoint`
```
describe_endpoint(specPath: "openapi.json", path: "/users/{id}", method: "PUT")
```
Возвращает полную схему запроса, параметры, коды ответов и требования безопасности.

### Проверяйте CRUD через `dryRun`
```
run_tests(testPath: "tests/crud.yaml", dryRun: true)
```
Показывает URL, метод и тело каждого запроса без отправки. Показывайте пользователю перед реальным запуском.

### Фильтруйте по тегам
```
run_tests(testPath: "tests/", tag: ["smoke"])
```
Быстрая проверка только ключевых сценариев. Используйте теги `smoke`, `crud`, `auth`, `destructive`.

### Структура `.env.yaml`

```yaml
# apis/petstore/.env.yaml — базовое окружение
base_url: https://api.example.com
token: your-token

# apis/petstore/.env.staging.yaml — staging окружение
base_url: https://staging.api.example.com
token: staging-token
```

Переменные из файла доступны в тестах как `{{base_url}}`, `{{token}}`.

---

## Что делать при проблемах

### Тесты падают — непонятно почему

```
query_db(action: "diagnose_failure", runId: <id>)
```

Возвращает только упавшие шаги с полем `response_body` — что именно ответил сервер. Каждый упавший шаг содержит поле `hint` с подсказкой по HTTP-статусу:

| HTTP статус | Hint |
|-------------|------|
| 401 / 403 | Auth failure — check auth_token/api_key in .env.yaml |
| 404 | Resource not found — verify the path and ID |
| 400 / 422 | Validation error — check request body fields match the schema |
| 5xx | Server-side error — inspect response_body for errorMessage/errorDetail |

### Авторизация не работает

Проверьте токен вручную:
```
send_request(
  method: "GET",
  url: "{{base_url}}/me",
  headers: '{"Authorization": "Bearer {{token}}"}',
  envName: "default"
)
```

### Непонятная схема запроса

```
describe_endpoint(specPath: "openapi.json", path: "/orders", method: "POST")
```

Возвращает полную схему тела запроса с типами, required-полями и примерами.

### Тесты не покрывают все эндпоинты

```
coverage_analysis(specPath: "openapi.json", testsDir: "apis/myapi/tests/")
generate_missing_tests(specPath: "openapi.json", testsDir: "apis/myapi/tests/")
```

`coverage_analysis` покажет процент покрытия, `generate_missing_tests` сформирует гайд только для пропущенных.

### Переменные не подставляются

Проверьте, что `.env.yaml` находится рядом с папкой `tests/` (или в родительской директории).

```
apis/petstore/
├── .env.yaml        ← должен быть здесь
└── tests/
    └── smoke.yaml
```

Имя переменной в файле (`base_url`) должно совпадать с `{{base_url}}` в тестах.

### Непонятно, что изменилось между запусками

```
query_db(action: "compare_runs", runId: <older>, runIdB: <newer>)
```

Показывает новые падения, исправленные тесты и изменения в производительности.
