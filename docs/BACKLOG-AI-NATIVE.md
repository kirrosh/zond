# BACKLOG — AI-Native API Testing Strategy

> APITOOL — CLI-инструмент, который позволяет AI-агентам (и людям) тестировать API из OpenAPI-спецификации без конфигурации.

Этот документ — новый бэклог, построенный вокруг позиционирования **"AI-native API testing tool"**, а не "конкурент Postman".

---

## Текущее состояние (v0.5.0, post-M25)

**Что уже есть:**
- 14 CLI команд, 11 MCP tools, AI chat agent
- MCP-first test generation: `generate_tests_guide` → `save_test_suite` → `run_tests` → `diagnose_failure`
- Enhanced `explore_api` with full request/response schemas (`includeSchemas`)
- AI-генерация тестов из OpenAPI (Ollama/OpenAI/Anthropic)
- Standalone binary, zero config
- WebUI dashboard с историей, трендами, API Explorer
- Collection architecture с environment scoping
- Coverage analysis (OpenAPI vs тесты)
- Tags + description в test suites, `--tag` фильтрация в CLI и MCP

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

## M23: Runner Improvements + MCP Refinements ✅ DONE

> Реализовано: Nested body assertions, root body type checking (_body), setup_api и generate_missing_tests MCP tools.

### Что сделано
- **Nested body assertions** — `flattenBodyAssertions` preprocessor: вложенный YAML `{ category: { name: { equals: "Dogs" } } }` автоматически сплющивается в `"category.name": { equals: "Dogs" }`. Dot-notation тоже работает.
- **Root body assertions (`_body`)** — `_body: { type: "array" }` проверяет тип самого body, не поле внутри. `_body.length: { gt: 0 }` — доступ к свойствам корневого body.
- **`setup_api` MCP tool** — регистрация API за один вызов (dirs + spec + env + collection). Shared core с CLI `add-api`.
- **`generate_missing_tests` MCP tool** — coverage + guide для только непокрытых endpoints.
- **Guide обновлён** — nested assertions, `_body`, int64 workaround, tools table с новыми tools.
- **Исправлен `z.record()` баг** — MCP SDK 1.27.1 не поддерживает `z.record()` в inputSchema. Заменено на JSON string в `send_request`, `manage_environment`, `setup_api`.
- **int64** — документирован workaround (фиксированные ID вместо capture автогенерированных). BigInt-парсер не нужен.
- **`suggest_fixes`** — не нужен: агент сам вызывает `diagnose_failure` → понимает ошибку → правит YAML.

### Верификация (Petstore, повторная)
Claude Code автономно: `setup_api` → `generate_tests_guide` → сохранил 6 сьютов → `run_tests` (28/32) → исправил 4 assertion'а под реальное поведение API → 32/32. Новые фичи использованы: `_body: { type: "array" }`, `_body: { type: "object" }`, `"category.name"` dot-notation.

### Обнаруженные проблемы качества генерации (для guide improvement)
Агент генерирует рабочие тесты, но есть паттерны которые можно улучшить через guide:

| # | Проблема | Решение |
|---|----------|---------|
| 1 | findByStatus/findByTags — только `_body: { type: "array" }`, нет проверки непустоты | Guide: добавить пример `_body.length: { gt: 0 }` для list endpoints |
| 2 | POST/create — иногда body не проверяется, только status | Guide: усилить hint — всегда проверять хотя бы ID/key fields в create response |
| 3 | Bulk create (createWithArray/List) — нет верификации что ресурсы реально созданы | Guide: добавить hint — после bulk create делать GET для проверки |
| 4 | Validation suites — только status codes, нет проверки error body | Guide: добавить пример `message: { exists: true }` или `type: { equals: "error" }` в error responses |
| 5 | Form upload endpoints (uploadImage) — пропускаются | Дальний бэклог: поддержка multipart/form-data в runner |

---

## M24: Tags + Description Support ✅ DONE

> Реализовано: `tags` и `description` поля в YAML test suites, `--tag` фильтрация в CLI и MCP, отображение тегов в console reporter.

### Что сделано
- **`tags: string[]` и `description: string`** — optional поля на уровне TestSuite (types + Zod schema)
- **`filterSuitesByTags()`** — утилита фильтрации: OR logic, case-insensitive, suites без тегов исключаются при фильтрации
- **CLI `--tag` флаг** — repeatable (`--tag smoke --tag crud`) и comma-separated (`--tag smoke,crud`), warning + exit 0 при отсутствии совпадений
- **MCP `run_tests` tool** — новый параметр `tag: string[]` для фильтрации через `executeRun()`
- **Console reporter** — отображает `[tag1] [tag2]` под именем сьюта (dimmed)
- **Validate tool** — включает `tags` и `description` в validation output details
- **Guide обновлён** — YAML template показывает `description` и `tags` как optional поля
- **`suite_tags` и `suite_description`** в `TestRunResult` — проброс из parsed suite через executor

### Верификация (Petstore)
Claude Code автономно сгенерировал 39 тестов в 6 сьютах, все с `tags` и `description`:
- `--tag crud` → 3 сьюта (29 тестов), `--tag pet` → 2 сьюта (14 тестов)
- `--tag store,validation` → 4 сьюта (OR logic, 15 тестов)
- `--tag nonexistent` → warning, exit 0
- MCP `run_tests` с `tag: ["crud"]` → 29/29 pass
- Console output: `[pet] [crud]`, `[store] [crud]`, `[user] [crud]`

### Оставшиеся задачи (перенесены в будущие milestone'ы)

| # | Задача | Описание |
|---|--------|----------|
| 1 | **Comment preservation** | Parser сохраняет YAML-комментарии при чтении/записи (сейчас теряются) |
| 2 | **`apitool docs` command** | Генерация markdown-документации из YAML-тестов: descriptions + examples |
| 3 | **WebUI: docs view** | Страница с отрендеренными descriptions и примерами запросов/ответов |
| 4 | **MCP: `get_api_docs` tool** | Агент может прочитать тесты как документацию |
| 5 | **Export: Markdown/HTML** | `apitool docs --format md --output docs/api.md` |

---

## M25: MCP + CLI Cleanup ✅ DONE

> Consolidation: 14 MCP tools → 11, 15 CLI commands → 14. Dead code removal.

### Что сделано
- **`query_db` MCP tool** — consolidated `list_collections`, `list_runs`, `get_run_results`, `diagnose_failure` into single tool with `action` enum
- **Deleted `list-environments.ts`** — dead code (removed from server.ts in M22, functionality in `manage_environment(action: "list")`)
- **Removed `request` CLI command** — users have curl; `send_request` MCP tool kept for agent use
- **Updated guide references** — `generate_tests_guide` and `run_tests` descriptions updated to reference `query_db`

### Результат

| Metric | Before | After |
|--------|--------|-------|
| MCP tools | 14 | 11 |
| CLI commands | 15 | 14 |
| MCP tool files | 14 | 11 |

---

## M26: WebUI Simplification

> Цель: упростить WebUI до 3 экранов: Runs, Run Detail, API Explorer. Убрать лишнее.

### Задачи (placeholder)

| # | Задача | Описание |
|---|--------|----------|
| 1 | **3-screen architecture** | Runs list → Run detail → API Explorer. Убрать suites management, trends |
| 2 | **Simplify navigation** | Одноуровневый nav без вложенности |
| 3 | **Remove dead pages** | Удалить неиспользуемые/сложные страницы |

---

## M27: CI/CD Native — "Drop-in Testing for Pipelines"

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

## M28: Позиционирование и Growth

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
M23 (Runner + MCP Fixes)   ✅ DONE
  ↓
M24 (Tags + Description)   ✅ DONE
  ↓
M25 (MCP + CLI Cleanup)    ✅ DONE
  ↓
M26 (WebUI Simplification) ← Упрощение до 3 экранов — NEXT
  ↓
M27 (CI/CD Native)         ← Расширение аудитории, retention
  ↓
M28 (Позиционирование)     ← README, GIFs, MCP каталоги, launch
```

**Критический путь:** M26 (WebUI) → M27 (CI/CD) → M28 (launch) — core фичи готовы, нужен polish и launch.

---

## Сравнение: старый бэклог vs AI-native

| Старый бэклог | AI-native бэклог | Статус |
|---------------|-------------------|--------|
| `request --save` | Smart AI generation (M22) | ✅ Done |
| WebUI Add API form | MCP `setup_api` tool (M23) | ✅ Done |
| OAuth2 в Explorer | AI-agent auth handling | ✅ Done (via generate_tests_guide) |
| Run comparison | CI/CD regression detection (M25) | Planned |
| Env inheritance | Auto-env extraction from spec | Partially (agent does it manually) |
| Test tags/filtering | `tags` + `--tag` in CLI/MCP (M24) | ✅ Done |
| WebUI polish | Demo GIFs + README rewrite (M26) | Planned |

**Принципиальная разница:** старый бэклог усиливал APITOOL как "API client для людей". Новый бэклог усиливает APITOOL как "AI-native testing tool" — инструмент, с которым AI-агент работает напрямую, а человек получает результаты.

---

## Timeline

| Milestone | Ключевой результат | Статус |
|-----------|-------------------|--------|
| M22 (MCP-First Generation) | generate_tests_guide + save_test_suite + enhanced explore_api | ✅ Done |
| M23 (Runner Fixes) | Nested assertions, _body, setup_api, generate_missing_tests, z.record fix | ✅ Done |
| M24 (Tags + Description) | tags, description, `--tag` filter in CLI/MCP, console display | ✅ Done |
| M25 (MCP + CLI Cleanup) | query_db consolidation, dead code removal, request CLI removed | ✅ Done |
| M26 (WebUI Simplification) | 3-screen WebUI, remove complexity | Planned |
| M27 (CI/CD Native) | GitHub Action, JUnit improvements | Planned |
| M28 (Launch) | README, GIFs, MCP каталоги, HN post | Planned |

---

## Технический долг (перенесён)

| Задача | Приоритет | Когда |
|--------|-----------|-------|
| Test isolation (`mock.module()` pollution) | Medium | До M22 (нужны стабильные тесты) |
| MCP `.mcp.json` relative paths | Medium | В рамках M23 |
| Explorer nested schema display | Low | Когда-нибудь |
