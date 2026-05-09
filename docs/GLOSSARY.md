# Тезаурус сущностей zond

Определения всех доменных сущностей системы. CLI-only после m-13: ни
WebUI, ни MCP, ни AI-чата на сервере — все артефакты живут в файловой
системе и SQLite, поверх которых работает CLI и агентские скиллы.

---

## API (registered API)

Верхнеуровневая единица. Группирует тесты, окружения и спецификацию
вокруг одного API. Регистрируется командой `zond add api <name>`.

| Поле в `collections` | Тип | Описание |
|------|-----|----------|
| `id` | INTEGER PK | Автоинкремент |
| `name` | TEXT | Уникальное имя API (e.g. `petstore`) |
| `base_dir` | TEXT | Корневая директория (`apis/<name>/`) |
| `test_path` | TEXT | Путь к директории с тестами (`apis/<name>/tests/`) |
| `openapi_spec` | TEXT? | Путь или URL к исходной OpenAPI-спецификации |
| `created_at` | TEXT | ISO 8601 |

Историческое имя таблицы — `collections`. На уровне CLI всегда
используется термин «API».

**Создание:** `zond add api <name> --spec <path|url> [--base-url <url>]`.

**Активный API.** Большинство команд принимают `--api <name>`. Если флаг
не задан, активный API резолвится в порядке: per-cmd `--api` →
глобальный `--api` (`zond --api <name> <cmd>`) → `ZOND_API` env-var →
`.zond/current-api` (выставляется `zond use <name>`). Если зарегистрирован
ровно один API — он выбирается автоматически (TASK-290).

**Структура артефактов:**

```
apis/
  petstore/                       # base_dir
    spec.json                     # снэпшот OpenAPI (source of truth, fixed by zond add api)
    .api-catalog.yaml             # компактный реестр endpoints (генерируется)
    .api-resources.yaml           # CRUD-связи между ресурсами (генерируется)
    .env.yaml                     # base_url + переменные/фикстуры — единственный env-файл API
    .secrets.yaml                 # сами секреты (опционально, в .gitignore)
    .env.staging.yaml             # дополнительные именованные окружения (опционально)
    tests/                        # test_path — пользовательские/сгенерированные сьюты
      smoke.yaml
      <resource>-crud.yaml
    probes/                       # эмитированные probe-сьюты (zond probe … --emit-tests)
      methods/
      validation/
      mass-assignment/
```

Команда `zond clean` чистит авто-генерируемые файлы по реестру в
`.zond/manifest.json` (TASK-156). `clean --api X` сохраняет `spec.json`
как input-снэпшот (TASK-226) и не трогает `probes/` без явного `--probes`
(TASK-258).

---

## Suite (тест-сьют)

YAML-файл с набором тестов: `name`, `base_url`, `headers`, `config`,
массив `tests`. Возможны теги — `tags: [smoke, unsafe]`.

**Хранение:** только файл на диске. В DB — только `suite_name` строкой в
таблице `results`. Файловая система — source of truth (git-friendly,
редактируется людьми, портируется). `parseDirectory()` обнаруживает
сьюты on demand.

**Ключевые поля:**

| Поле | Описание |
|------|----------|
| `name` | Имя сьюта (показывается в отчётах) |
| `description` | Описание (рендерится в шапке HTML-отчёта) |
| `tags` | Массив тегов (фильтр `--tag` / `--exclude-tag`, попадают в `tags`-колонку run) |
| `base_url` | Базовый URL для всех тестов (поддерживает `{{base_url}}`) |
| `headers` | Общие заголовки (e.g. `Authorization`) |
| `config` | `timeout`, `retries`, `retry_delay`, `follow_redirects`, `verify_ssl` |
| `tests` | Массив TestStep |

---

## Test Step (шаг теста)

Один HTTP-запрос внутри сьюта. Метод + путь + тело + assertions +
captures.

| Поле | Описание |
|------|----------|
| `name` | Имя шага |
| `method` | HTTP-метод: GET, POST, PUT, PATCH, DELETE |
| `path` | URL-путь (поддерживает `{{переменные}}`) |
| `headers` | Заголовки запроса |
| `json` / `form` / `multipart` | Тело запроса |
| `query` | Query-параметры |
| `expect` | Ассерты: `status`, `body`, `headers`, `duration` |
| `capture` | Извлечение значений из ответа в переменные |
| `always: true` | Cleanup-шаг — выполняется даже если предыдущие упали |
| `for_each` / `parameterize` | Цикл/параметризация на уровне шага/сьюта |
| `retry_until` | Retry до достижения условия |

**DB-результат:** таблица `results` — `suite_name`, `test_name`, `status`,
`request_*`, `response_*`, `assertions` (JSON), `captures` (JSON). Запись
проходит через redaction-pipeline (TASK-167) — секреты в `request_body`,
`response_body`, заголовках авто-маскируются.

---

## Run (прогон)

Факт запуска тестов. Суммарная статистика, привязка к API и окружению.

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | INTEGER PK | Автоинкремент |
| `started_at` / `finished_at` | TEXT | ISO 8601 |
| `total` / `passed` / `failed` / `skipped` / `errored` | INTEGER | Счётчики (TASK-230 учитывает errored отдельно) |
| `trigger` | TEXT | `manual`, `cli`, `ci` (стампится `zond run --all` / `ZOND_TRIGGER`) |
| `environment` | TEXT? | Имя использованного окружения |
| `duration_ms` | INTEGER? | Длительность прогона |
| `collection_id` | INTEGER? | FK → API (`collections`) |
| `session_id` | TEXT? | UUID кампании, см. Session ниже |
| `commit_sha` / `branch` | TEXT? | CI-контекст (`ZOND_COMMIT_SHA` / `ZOND_BRANCH`, либо auto от `zond run --all`) |
| `tags` | TEXT (JSON) | Список тегов из всех сьютов прогона |

Run’ы с 0 passed и errors > 0 классифицируются как FAIL (medium-1 fix).

---

## Session (кампания)

Группирует несколько `zond run` под одним `session_id`. Используется,
когда CI или агент запускает sweep `tests + probes + mass-assignment` и
хочет считать coverage союзом всех run’ов.

```
zond session start --label "post-deploy sweep"  # пишет UUID в .zond/current-session
zond run apis/<api>/tests
zond run apis/<api>/probes
zond coverage --api <api> --union session
zond session end
```

Резолюция `session_id` для `zond run`:
1. `--session-id <uuid>` (явно).
2. `ZOND_SESSION_ID` env (CI).
3. `.zond/current-session` (выставлен `zond session start`).

Без них run считается ad-hoc и в `--union session` не попадает.

---

## Environment (окружение)

Именованный набор переменных (`{{base_url}}`, `{{token}}`, FK-фикстуры).
Единственный источник истины — файлы на диске.

**Файловая модель (на API-уровень):**
- `apis/<name>/.env.yaml` — дефолтное окружение (имя `""`).
- `apis/<name>/.env.<name>.yaml` — именованные окружения.
- `apis/<name>/.secrets.yaml` — отделённые секреты, на которые `.env.yaml`
  ссылается через `{ secret: <key> }`. Сами значения попадают в
  redaction-registry автоматически.

`.env.yaml` живёт **только** на уровне API — не дублируется внутри
`tests/` (TASK-158). `zond run --env <name>` выбирает именованное
окружение.

`zond init` добавляет `.env*.yaml` и `.secrets.yaml` в `.gitignore`, чтобы
секреты не попадали в репозиторий.

---

## Variable / Capture

Механизм передачи данных между шагами и окружениями.

**Источники:**
- Environment (`.env.yaml` / `.env.<name>.yaml`).
- Captures из ответов предыдущих шагов.
- Встроенные генераторы: `$uuid`, `$timestamp`, `$randomName`,
  `$randomEmail`, `$randomString`, `$randomUrl`, `$randomInt`,
  `$randomSlug`, `$nullByte` и др. (см. `zond reference random-helpers`
  или `docs/random-helpers.md`).
- ENV_VAR-substitution в `.env.yaml` (`${HOME}`-style).

**Подстановка:** `{{variable_name}}` — в path, headers, body, query,
assertions. Если вся строка — `{{var}}`, возвращается raw-значение
(число остаётся числом). Иначе — конвертируется в string.

`zond run --strict-vars` падает на неразрешённые переменные.

---

## OpenAPI Spec (спецификация API)

Описание API в формате OpenAPI 3.x. Используется для:
- `zond add api` / `zond refresh-api` — снэпшот `spec.json` + 3
  артефакта (`.api-catalog.yaml`, `.api-resources.yaml`,
  `.env.yaml`-skeleton).
- `zond generate` — синтез YAML-сьютов (CRUD + smoke).
- `zond probe static` — генерация validation/methods probe-сьютов.
- `zond probe security` / `probe mass-assignment` — live-probes против
  spec-доступных endpoint’ов.
- `zond check spec` — статический анализ (rules A1–B9).
- `zond coverage` — сопоставление endpoint’ов с результатами run’ов.
- `zond request --validate-against` — pin ad-hoc-запроса к ответу из
  schema (TASK-142).

**Хранение:** `apis/<name>/spec.json` — байтовый снэпшот (specHash в
artifact-header сравнивается с хешем файла, TASK-215). Перерезка —
`zond refresh-api`.

---

## Recommended action (триаж-action)

Каждое падение / probe-finding несёт `recommended_action` из закрытого
enum (TASK-294). Скилл `zond-triage.md` маршрутизирует работу по этому
полю.

| Action | Источники | Что делать |
|---|---|---|
| `fix_env` | `db diagnose` env-issue detector | поправить `base_url` / `auth_token` в `.env.yaml` |
| `fix_fixture` | `prepare-fixtures` miss-*, mass-assignment INCONCLUSIVE-baseline | `zond prepare-fixtures --apply [--cascade [--seed]]` |
| `fix_test_logic` | `db diagnose` (assertion-mismatch без 5xx) | поправить YAML-тест (или `zond run --learn` для status-drift) |
| `report_backend_bug` | 5xx, mass-assignment HIGH (privilege-escalation), security HIGH | `zond report bundle --include case-study` → отдать backend-команде |
| `update_spec` | `zond run --learn` status-drift (200 vs 201) | пересогласовать spec / `--learn-apply` |

---

## Probe (зонд)

Категория автоматических проб spec-driven endpoint’ов:

| Класс | Live? | Что ищет |
|---|---|---|
| `probe static` (validation + methods) | нет — генерирует YAML, потом `zond run` исполняет | 5xx-on-bad-input + 5xx/2xx на необъявленные методы (TASK-300 объединил два класса) |
| `probe mass-assignment` | да | privilege-escalation через extra payload-fields (`is_admin`, `role`, …) |
| `probe security <classes>` | да | SSRF / CRLF / open-redirect; classes = subset of `ssrf,crlf,open-redirect` |

Каждый probe пишет findings в `recommended_action`-таксономии (см.
выше) и опционально эмитит regression-сьюты в `apis/<name>/probes/`.

---

## Manifest (`.zond/manifest.json`)

Реестр всех файлов, которые сгенерировал zond (catalog/resources/fixtures
артефакты, probe-сьюты, audit-отчёты). `zond clean` опирается на этот
реестр и не трогает файлы пользователя (TASK-156). Реестр пишется
append-only; при сбое середина транзакции восстановима.

---

## Orphan resources (`~/.zond/orphans/`)

Live-probes (`mass-assignment`, `security`) логируют каждый созданный, но
неудалённый ресурс в `~/.zond/orphans/<api>.ndjson`. `zond cleanup
--orphans` повторно отправляет DELETE и помечает запись `removed: true`,
если ресурс действительно ушёл / 404 (TASK-278). `ZOND_ORPHANS_DIR`
переопределяет директорию (test suite пользуется).

---

## Settings (настройки)

Глобальные key-value в таблице `settings`. На текущий момент
используются для нечастых сервисных флагов (per-test feature toggles).
AI-чат / провайдеры / секреты — здесь **не** живут (TASK-285 удалил
self-update; AI-генерация не входит в текущий surface).
