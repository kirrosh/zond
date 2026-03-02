# BACKLOG — AI-Native API Testing Strategy

> APITOOL — CLI-инструмент, который позволяет AI-агентам (и людям) тестировать API из OpenAPI-спецификации без конфигурации.

Этот документ — новый бэклог, построенный вокруг позиционирования **"AI-native API testing tool"**, а не "конкурент Postman".

---

## Текущее состояние (v0.4.0, post-M22)

**Что уже есть:**
- 15 CLI команд, 13 MCP tools, AI chat agent
- MCP-first test generation: `generate_tests_guide` → `save_test_suite` → `run_tests` → `diagnose_failure`
- Enhanced `explore_api` with full request/response schemas (`includeSchemas`)
- AI-генерация тестов из OpenAPI (Ollama/OpenAI/Anthropic)
- Standalone binary, zero config
- WebUI dashboard с историей, трендами, API Explorer
- Collection architecture с environment scoping
- Coverage analysis (OpenAPI vs тесты)

**Что не работает как selling point:**
- WebUI как конкурентное преимущество (у Postman лучше, и всегда будет)
- Позиционирование "всё в одном" (невозможно для соло-разработчика)
- Конкуренция за QA-инженеров (у них свой pipeline)

---

## Стратегический фокус

### Primary interface: MCP (для AI-агентов)
### Secondary interface: CLI (для людей)
### Utility: WebUI (просмотр результатов, не более)

### Целевая аудитория:
1. **Разработчики с AI-ассистентами** (Claude Code, Cursor, Windsurf)
2. **Соло/маленькие команды** без QA — хотят "протестировать API за 30 секунд"
3. **CI/CD pipelines** — один бинарник, JUnit XML, zero dependencies

---

## M22: MCP-First Smart Test Generation ✅ DONE

> Реализовано: AI-агент через MCP получает полную спеку с схемами, алгоритм генерации, сохраняет и валидирует тесты.

### Что сделано
- **`generate_tests_guide` tool** — возвращает полную API-спеку (compressed schemas) + пошаговый алгоритм генерации + YAML format reference + типичные ошибки
- **`save_test_suite` tool** — парсит YAML, валидирует через Zod-схему, сохраняет файл. При ошибке — structured error с hint
- **`explore_api` enhanced** — новый параметр `includeSchemas: true` → request/response body schemas, parameter types, security per endpoint
- **`schema-utils.ts`** — `compressSchema()` и `formatParam()` извлечены в shared-модуль
- **Удалён `list_environments`** — дублировал `manage_environment(action: "list")`
- **Улучшены descriptions** для `run_tests`, `diagnose_failure`, `coverage_analysis`, `explore_api`

### Верификация (Petstore)
Claude Code автономно сгенерировал 35 тестов в 6 сьютах (pet/store/user × crud/validation):
- Правильные CRUD lifecycles с captures и cleanup
- Validation suites (404, invalid data, missing fields)
- Самостоятельно нашёл и обошёл: int64 overflow, нерабочий v3 API, array body type checking

### Обнаруженные проблемы (для будущих milestone'ов)
- **Nested body assertions** — `body.category.name` не поддерживается runner'ом (только плоский уровень)
- **Array body type checking** — `body: { type: "array" }` ищет поле `type` внутри тела, а не проверяет тип самого тела
- **int64 precision** — JS теряет точность для больших int64 ID при capture → подстановке

---

## M23: Runner Improvements + MCP Refinements

> Цель: Исправить проблемы, найденные при верификации M22. Усилить runner и MCP workflow.

### Проблемы из M22 верификации

| # | Проблема | Описание |
|---|----------|----------|
| 1 | **Nested body assertions** | Runner проверяет только плоские `body.field`. Нужно: `body.category.name` → глубокий path access |
| 2 | **Array body type checking** | `body: { type: "array" }` не проверяет тип самого тела. Нужен спец-ключ (напр. `_root`) или флаг |
| 3 | **int64 precision** | JS Number теряет точность для int64. Нужно: string-based capture/compare для больших чисел |

### MCP Workflow (перенесено из старого M23)

| # | Задача | Описание |
|---|--------|----------|
| 4 | **MCP: `setup_api` tool** | Объединяет add-api + env setup в один вызов |
| 5 | **MCP: `suggest_fixes` tool** | На основе diagnose_failure — предлагает конкретные правки YAML |
| 6 | **MCP: `generate_missing_tests` tool** | coverage_analysis → возвращает guide только для непокрытых endpoints |

### Уже сделано в M22 (вычеркнуто из старого M23)
- ~~generate_tests tool~~ → `generate_tests_guide` + `save_test_suite`
- ~~Rich tool descriptions~~ → descriptions обновлены с "when to use" hints
- ~~Passthrough generation~~ → агент сам генерирует YAML, apitool валидирует через `save_test_suite`
- ~~test_api pipeline tool~~ → не нужен, агент сам оркестрирует `run_tests` → `diagnose_failure`

### Метрика успеха
- Nested assertions работают: `body.data[0].id`, `body.category.name`
- Сгенерированные тесты для Petstore проходят без workaround'ов для int64
- `setup_api` — регистрация API за один MCP-вызов

---

## M24: Test Suites as Documentation

> Цель: YAML-тесты = живая документация API. Читаешь тест — понимаешь API.

### Концепция
```yaml
# apis/petstore/tests/pets-crud.yaml
name: "Pet Store — Managing Pets"
description: |
  API для управления питомцами в зоомагазине.

  ## Основные операции:
  - Добавление нового питомца (требует авторизации)
  - Поиск по статусу (available, pending, sold)
  - Обновление данных питомца
  - Загрузка фото питомца

  ## Бизнес-правила:
  - Имя и photoUrls — обязательные поля
  - Статус по умолчанию — "available"
  - Удалить можно только свои питомцы

tags: [pets, crud, core]
base_url: "{{base_url}}"

tests:
  - name: "Add a new pet to the store"
    # Создаём питомца с минимальным набором обязательных полей.
    # API возвращает полный объект с сгенерированным ID.
    POST: /pet
    headers:
      Authorization: "Bearer {{token}}"
    json:
      name: "Buddy"
      photoUrls: ["https://example.com/buddy.jpg"]
      status: "available"
    expect:
      status: 200
      body:
        id: { capture: pet_id, type: integer }
        name: { equals: "Buddy" }
        status: { equals: "available" }
```

### Задачи

| # | Задача | Описание |
|---|--------|----------|
| 1 | **Tags support в YAML** | `tags: [auth, crud, pets]` — для фильтрации и группировки |
| 2 | **Description field** | Top-level `description` в suite — markdown-текст, объясняющий API |
| 3 | **Comment preservation** | Parser сохраняет YAML-комментарии при чтении/записи (сейчас теряются) |
| 4 | **`apitool docs` command** | Генерация markdown-документации из YAML-тестов: descriptions + examples |
| 5 | **WebUI: docs view** | Страница с отрендеренными descriptions и примерами запросов/ответов |
| 6 | **MCP: `get_api_docs` tool** | Агент может прочитать тесты как документацию |
| 7 | **Export: Markdown/HTML** | `apitool docs --format md --output docs/api.md` |

### Метрика успеха
- Новый разработчик понимает API, прочитав тест-файлы без дополнительной документации
- `apitool docs` генерирует полезный markdown за одну команду
- Tags позволяют запускать `apitool run --tag auth` — только auth-тесты

---

## M25: CI/CD Native — "Drop-in Testing for Pipelines"

> Цель: `apitool` в CI за 3 строки YAML, без Docker, npm, конфигурации.

### Задачи

| # | Задача | Описание |
|---|--------|----------|
| 1 | **GitHub Action** | `uses: kirrosh/apitool-action@v1` — скачивает бинарник, запускает тесты, публикует results |
| 2 | **JUnit XML reporter (улучшение)** | Полностью совместимый JUnit XML для GitHub/GitLab/Jenkins native rendering |
| 3 | **Exit codes** | Чёткие exit codes: 0=all pass, 1=failures, 2=errors, 3=no tests found |
| 4 | **`--fail-on-coverage` flag** | Fail CI если покрытие ниже порога: `apitool run --fail-on-coverage 80` |
| 5 | **Summary output** | Machine-readable summary для CI step outputs (pass/fail/skip counts, duration) |
| 6 | **Env from CI secrets** | `apitool run --env-var "token=$API_TOKEN"` — передача секретов без файлов |
| 7 | **`apitool compare` command** | Сравнение двух прогонов — regression detection в CI |

### Пример GitHub Actions workflow
```yaml
- name: Test API
  uses: kirrosh/apitool-action@v1
  with:
    api: myapi
    spec: openapi.json
    env-vars: |
      base_url=${{ secrets.API_URL }}
      token=${{ secrets.API_TOKEN }}
    fail-on-coverage: 80
```

### Метрика успеха
- Интеграция в CI за <5 минут
- Native rendering результатов в GitHub/GitLab
- Прозрачные exit codes для pipeline conditions

---

## M26: Позиционирование и Growth

> Цель: 500 GitHub stars, присутствие в MCP-каталогах, 10+ реальных MCP-пользователей.

### Задачи

| # | Задача | Описание |
|---|--------|----------|
| 1 | **Переписать README** | AI-native позиционирование: MCP → CLI → WebUI. Три hero-сценария |
| 2 | **Landing demo GIFs** | 3 GIF: (a) Claude Code тестирует API, (b) 30-second CLI flow, (c) coverage → auto-generate |
| 3 | **MCP каталоги** | Регистрация в mcp.so, awesome-mcp-servers, glama.ai |
| 4 | **Blog post** | "How I use Claude Code to test my API automatically" |
| 5 | **HN/Reddit launch** | "I built a tool that lets AI agents test your API" (НЕ "Postman alternative") |
| 6 | **Examples directory** | 3-5 реальных примеров: Petstore, Stripe-like, простой REST, auth-heavy API |
| 7 | **`.mcp.json` auto-setup** | `apitool init` определяет IDE и создаёт правильный конфиг |

---

## Что НЕ делать

| Искушение | Почему нет |
|-----------|------------|
| GraphQL / gRPC / WebSocket | REST + OpenAPI = 80% рынка. Фокус. |
| Нагрузочное тестирование | Есть k6. Лучше интеграция, чем свой load tester |
| WebUI polish (animations, themes, drag-and-drop) | Не selling point. Утилитарный дашборд — достаточно |
| Плагины / маркетплейс | Требует команды 10+ человек |
| Командная работа / shared workspaces | Enterprise фича, не для текущего этапа |
| Team features / RBAC | Другая категория продукта |
| Конкуренция с Postman за QA-инженеров | Другая аудитория |

---

## Приоритет выполнения

```
M22 (MCP-First Generation) ✅ DONE
  ↓
M23 (Runner + MCP Fixes)   ← Исправить найденные проблемы
  ↓
M26 (Позиционирование)     ← README, GIFs, MCP каталоги — можно параллельно
  ↓
M24 (Tests as Docs)        ← Усиливает ценность генерации
  ↓
M25 (CI/CD Native)         ← Расширение аудитории, retention
```

**Критический путь:** M23 (runner fixes) → M26 (launch) — MCP generation уже работает, нужен polish и launch.

---

## Сравнение: старый бэклог vs AI-native

| Старый бэклог | AI-native бэклог | Статус |
|---------------|-------------------|--------|
| `request --save` | Smart AI generation (M22) | ✅ Done |
| WebUI Add API form | MCP `setup_api` tool (M23) | Planned |
| OAuth2 в Explorer | AI-agent auth handling | ✅ Done (via generate_tests_guide) |
| Run comparison | CI/CD regression detection (M25) | Planned |
| Env inheritance | Auto-env extraction from spec | Partially (agent does it manually) |
| WebUI polish | Demo GIFs + README rewrite (M26) | Planned |

**Принципиальная разница:** старый бэклог усиливал APITOOL как "API client для людей". Новый бэклог усиливает APITOOL как "AI-native testing tool" — инструмент, с которым AI-агент работает напрямую, а человек получает результаты.

---

## Timeline

| Milestone | Ключевой результат | Статус |
|-----------|-------------------|--------|
| M22 (MCP-First Generation) | generate_tests_guide + save_test_suite + enhanced explore_api | ✅ Done |
| M23 (Runner Fixes) | Nested assertions, array body, int64 fix, setup_api | Next |
| M26 (Launch) | README, GIFs, MCP каталоги, HN post | Planned |
| M24 (Tests as Docs) | tags, description field, `apitool docs` | Planned |
| M25 (CI/CD Native) | GitHub Action, JUnit improvements | Planned |

---

## Технический долг (перенесён)

| Задача | Приоритет | Когда |
|--------|-----------|-------|
| Test isolation (`mock.module()` pollution) | Medium | До M22 (нужны стабильные тесты) |
| MCP `.mcp.json` relative paths | Medium | В рамках M23 |
| Explorer nested schema display | Low | Когда-нибудь |
