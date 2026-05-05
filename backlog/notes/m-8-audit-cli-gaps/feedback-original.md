# Фидбэк по работе с zond (тестирование JSONPlaceholder)

> Дата: 2026-05-05
> Версия zond: 0.22.0 (bun)
> API: https://jsonplaceholder.typicode.com/

## Что получилось хорошо

### 1. zond init — отлично
- Быстро бутстрапит воркспейс: zond.config.yml, zond.db, структура apis/
- Сразу понятно, куда класть тесты и сценарии

### 2. zond add api — быстрый старт
- Регистрирует API в структуре, создаёт папку apis/<name>/
- Создаёт .env.yaml с базовым base_url

### 3. Запуск тестов по YAML — zond run
- Работает без регистрации в БД: можно просто указать путь к файлу
- Отчёт в `--report console` / `--report json` — читабельно и машинно
- Хорошая детализация: request/response headers, body, длительность
- Pass/fail по каждому шагу, captures между шагами работают

### 4. zond session start/end — группировка запусков
- Удобно: одна сессия на всю кампанию, чистый список в db runs
- Все три запуска легли под одним session_id

### 5. zond request — ad-hoc HTTP
- Быстрый способ кинуть запрос и увидеть полный ответ
- Удобно дебажить формат ответа перед написанием YAML

### 6. Переменные ({{var}}, captures)
- {{base_url}} из .env.yaml подставляется в YAML
- { capture: user_id } работает: value из /users/1 → /posts?userId={{user_id}}
- Прозрачно и предсказуемо

### 7. SQLite история (zond.db)
- Все запуски сохраняются
- zond db runs показывает результат компактно

## Затыки и проблемы

### 1. Нет OpenAPI-спеки — zond теряет половину функционала
JSONPlaceholder не имеет публичной OpenAPI-спеки. Без неё:
- `zond doctor --api jsonplaceholder` → "API not found" (API не зарегистрирован в БД)
- `zond generate` не работает — нет spec.json
- `zond probe-validation` / `probe-methods` — тоже нужен spec.json
- `.api-catalog.yaml`, `.api-resources.yaml`, `.api-fixtures.yaml` — артефакты не сгенерированы

**Итог:** для mock/типокодных API без OpenAPI весь автоген и probe-слой недоступен. Можно тестировать только через ручные YAML + zond request.

**Предложение:** поддержать регистрацию API без spec.json — чисто по base_url. Тогда zond doctor будет знать об API (даже без spec), zond run с --api сможет резолвить base_url из env, а probe-команды — говорить "spec needed, run `zond add api --spec ...`".

### 2. Ошибка в тесте posts-crud.yaml
```
test: "get post 404 - returns empty object"
expect:
  status: 200          # ← неверно, API честно возвращает 404
```
Тест написан с ожиданием 200 для несуществующего поста. Это баг теста, не API. zond отработал честно — статус не совпал, тест упал.

### 3. zond request: нет `--json` флага
```
zond request POST /posts --body '{}' --json  ← error: unknown option
```
Оказалось, что `--json` — это флаг формата вывода у `run`, а у `request` свой `--json`. Всё работает, но путает: надо смотреть --help каждой подкоманды отдельно.

### 4. zond request требует полный URL
Без `--api <name>` команда `zond request POST /posts --body '{}'` выдаёт "fetch() URL is invalid". Нужно `zond request POST https://jsonplaceholder.typicode.com/posts --body '{}'`.

**Предложение:** если указан `--api <name>`, резолвить base_url из .env.yaml и подставлять в URL. Аналогично zond run.

### 5. DELETE возвращает 200, не 204
JSONPlaceholder на DELETE /posts/1 отвечает 200 с пустым телом `{}`. Многие REST-фреймворки отдают 204 No Content. Разные ожидания могут ломать тесты без явной вины теста.

### 6. Проблемы с bun-пайпами и парсингом JSON
Вывод zond request --json — это структура с `{ok, data: {status, headers, body, duration_ms}}`, что удобно, но Python/Bun-скрипты на пайпах нестабильно работают (ошибка EventEmitter на Bun eval). Хотелось бы встроенный `--json-path <dotpath>` для извлечения одного поля.

### 7. Связка относительный URL + base_url из env
В YAML-тестах `base_url: "{{base_url}}"` из .env.yaml подставляется автоматом.
В `zond request` — нет. Консистентность повела бы себя иначе.

## Итоговые цифры

| Этап | Результат |
|------|-----------|
| Smoke (8 тестов) | 8/8 PASS |
| CRUD posts (4 теста) | 3/4 PASS (1 баг теста — неверное ожидание статуса) |
| User profile scenario (4 теста, cross-endpoint captures) | 4/4 PASS |
| Ad-hoc POST/PUT/PATCH/DELETE | Все статусы корректны |
| Probe-генерация из спеки | Недоступна — нет OpenAPI |
| Всего запусков в БД | 4 (run #1-4) |

---

# Фидбэк по работе с zond — раунд 2 (Sentry Public API)

> Дата: 2026-05-05
> Версия zond: 0.22.0 (bun)
> API: https://us.sentry.io (Sentry Public API v0, OpenAPI 3.0.3, 219 endpoints)
> Контекст: полный аудит реального production-API с настоящим auth-токеном

## Где zond реально вытащил находки

### 1. Smoke `--safe` поверх настоящего org-slug — главный источник 5xx
3 backend-бага (репозитории, replays) нашлись прямым `zond run --safe` после того, как в `.env.yaml` оказались **реальные** значения `organization_id_or_slug` / `project_id_or_slug`. Это лучший ROI за минуту запуска: 230 GET, 3 чистых 5xx, всё уже с автоматической классификацией `report_backend_bug` в `zond db diagnose`.

### 2. `zond db diagnose <id>` — отличный фильтр шума
- Поле `agent_directive` — просто текстовая инструкция «эти 3 — баги бэка, эти 87 — fix_test_logic», экономит человекочасы.
- `env_issue` секция сразу подсветила, что 2 SCIM-suite валятся по auth-scope, не по тесту.
- `recommended_action` × `root_cause` — дисциплинирует не править expects ради зелёного прогона.

### 3. probe-mass-assignment — нашёл 3 HIGH с минимумом конфигурации
Достаточно было реального `auth_token`, и проб сам нашёл 502/500 на `PUT /issues/` и `PUT /members/{id}/` плюс 51 INCONCLUSIVE с понятной причиной. Эмитит регрессионные YAML-сьюты в `--emit-tests` — можно сразу commit'нуть в CI.

### 4. probe-methods — низкий уровень шума, точечные находки
431 запрос → 1 fail = `POST /api/0/organizations/` (недокументированный метод, contract drift). Сигнал-в-шуме почти 1:1.

### 5. Сессии под кампанию
`zond session start/end` идеально лёг под фразу «прогнать sanity → smoke → CRUD → probes одним блоком». Все 4 run'а в одном `session_id`, легко собрать сравнительный отчёт.

### 6. `--rate-limit auto` против Sentry
Авточтение `x-sentry-rate-limit-*` хедеров отработало: на 2665 проб-запросах прилетел только 1 × 429 (на autofix endpoint, у него отдельный лимит 25/мин). Без auto пришлось бы вручную тюнить.

### 7. `zond report case-study <id>` / `zond report export <run>`
Готовый Markdown / single-file HTML — копируется в issue без редактирования. HTML-отчёт пережил `du -sh` в 1 МБ на 230 шагов, открывается локально без сервера.

### 8. Идемпотентные ручные probes (CRLF)
Возможность написать YAML с `always: true` cleanup'ами позволила проверить **stored CRLF injection** на живом проекте без следов: capture original → mutate → assert → restore. Самая ценная находка раунда (HIGH security) сделана этим паттерном за 5 минут.

## Чего реально не хватило

### A. probe-validation использует `nonexistent-zzzzz` для parent slug — короткое замыкание
**Симптом:** все 3 × 5xx из smoke (`replays/{replay_id}/...`, `repos/{repo}/commits`) probe-validation **не нашёл**, хотя именно для этого он и есть.

**Причина:** probe ставит `nonexistent-zzzzz` в `{organization_id_or_slug}` → API возвращает 404 ещё до того, как доберётся до валидации path-параметра ниже. Все 2665 проб обнулили нестандартные id, но ни одна не была вложена в реальный родитель.

**Предложение:**
- Опция `--use-real-parents` (или поведение по умолчанию): если в `.env.yaml` есть реальный `organization_id_or_slug` / `project_id_or_slug`, использовать его как parent, а ломать только конечный path-param. Это **дешёвая** правка с огромным эффектом на recall.
- Альтернатива: матрица `parent ∈ {real, fake} × leaf ∈ {malformed, valid-but-missing}` — 4 сэмпла × тип, не 1.

### B. probe-mass-assignment: 51 INCONCLUSIVE из-за фикстур, ручной catch-up плохо масштабируется
Скилл правильно говорит «допиши `.env.yaml` и пересобери», но 51 endpoint × FK-id вручную — нереально для разовой сессии. И phase 5.1 в скилле описывает per-endpoint YAML-template, тоже руками.

**Предложение:**
- `zond probe-mass-assignment --discover-fk` — пробежаться по соседним list-endpoints (`/audiences`, `/domains` и т.п.) и автоматически наполнить кэш fixture-id, как уже умеет phase 5 для path-параметров. Сейчас digest сообщает причину, но не пробует исправить.
- `--retry-inconclusive` после фикстур — пересобрать только те, что были INCONCLUSIVE, чтобы не гонять весь пробник заново.

### C. CRUD-чейны сильно завязаны на «классическую» REST-форму
`zond generate` сделал только 2 CRUD-suite (Groups, Users — оба SCIM, оба требуют Enterprise-плана). Десятки реальных CRUD-ресурсов Sentry (alert-rules, dashboards, monitors, releases…) не попали в чейны.

**Гипотеза:** detector ищет `POST /<r>` + `GET /<r>/{id}` + `DELETE /<r>/{id}` строго в этой форме. Sentry часто делает `POST /<r>/` (slash) или `POST /<r>` без response → схема `{id}` как path-параметр.

**Предложение:** ослабить эвристику — если `POST` возвращает body с любым полем, аллегорично-id-подобным (`uuid`, `slug`, `version`), и есть `DELETE` с любым path-параметром на том же родителе, считать это chain-кандидатом. И/или `zond generate --explain` — показать, какие endpoints были рассмотрены и почему отвергнуты.

### D. `zond db run <id> --status <code>` — нет фильтра по диапазону
Хочется `--status 5xx` или `--status '>=500'`. Сейчас приходится 500/501/502/503 руками или через jq на `zond db run --json | jq '.data.results[] | select(.response_status>=500)'`. Мелочь, но для триажа критично.

### E. Case-study рендерит full body — иногда 1000+ строк JSON
`zond report case-study 3612` для PUT /projects/.../ выдал 1100 строк markdown потому что response — это весь project object с кучей `features[]` и `plugins[]`. Релевантного — 2 строки (subjectPrefix). В TODO-заглушках не указано «сократить».

**Предложение:**
- Опция `--body-cap <n>` (default 200 строк) с placeholder'ом «... truncated, see run #X result #Y».
- Или smart-mode: показывать только diff между ожиданием и фактом + поля, упомянутые в assertions.

### F. SSRF-probe на `POST /sentry-apps/` дал 404 — нет dry-run / capability check
Пришлось вручную убедиться, что endpoint вообще доступен с этим scope'ом. Скилл подсказывает шаблон, но не проверяет, доходит ли запрос до URL-валидатора. Получаем «5 fail на одной строке `404 — must reject`», что даёт 0 информации.

**Предложение:** в шаблонах probe-security перед атакой делать «baseline-OK» шаг — отправить полностью валидный body и убедиться, что он бы создал ресурс (или хотя бы доходит до validator). Если baseline сам отдаёт 4xx — пометить весь suite SKIPPED-INCONCLUSIVE. Это уже есть в probe-mass-assignment, но не в скилле для security.

### G. Отсутствие схемы-валидатора body в request-time для одного шага
`--validate-schema` есть на уровне run, но иногда хочется проверить **только** один ad-hoc запрос против конкретного response branch. Например, я делал `zond request GET /api/.../projects/`, и хотел бы автомат «соответствует ли тело декларации в spec». Сейчас — только встраивая в YAML.

**Предложение:** `zond request ... --validate-against <method> <path>` или `--api <name> --validate-schema`.

### H. Прерывания сети портят run — нет встроенного retry
17 `network_errors` в первом smoke (`-w` parallel). При `--sequential` они исчезли, но я узнал это только запустив второй раз. Хотелось бы:
- `--retry-on-network <N>` (default 1) — авто-повтор только при `ECONNRESET`/socket close, не при HTTP-кодах.

### I. `zond doctor --json` структура слегка путана
`.data.fixtures.required` — массив, но нет `.diagnostics` на верхнем уровне (как написано в подсказке). Я несколько раз промахнулся на `jq '.diagnostics.fixtures'`. Документировать canonical путь в `--help` или давать query helper типа `zond doctor --missing-only`.

## Замечания по самому скиллу `zond`

### Хорошо
- **Iron rules в начале** — действительно рулят ходом сессии (особенно «5xx → STOP, не править expect»).
- **Таблица entry points** — экономит время, я попадал в нужную фазу сразу.
- **«Когда передавать в zond-scenarios»** — ясный cutoff, не размывает аудит-режим.

### Можно улучшить
1. **Phase 5.1 (manual mass-assignment catch-up)** — шаблон есть, но бойлерплейт большой. Дайте `zond probe-mass-assignment --emit-template <endpoint>`, чтобы из CLI можно было получить готовый YAML с расставленными captures и cleanup'ами.

2. **Phase 5.2/5.3 (security probes)** — текстовые шаблоны в markdown скилла. Я скопипастил CRLF-шаблон руками за 5 минут, но это всё ещё ручная работа. Команда `zond probe-security <classes> --output ...` со встроенными SSRF/CRLF-генераторами и автоопределением полей (`webhookUrl`, `subjectPrefix`) поверх spec-каталога была бы естественным следующим шагом.

3. **Discovery fixtures** — сейчас в Phase 2.5 я **руками** делал `zond request GET /organizations/`, `... /projects/`, `... /members/` чтобы достать настоящие id. Это ровно то, что чек-листно для каждого API. Команда `zond discover --api sentry --auth ...` — пройтись по `.api-resources.yaml` list-endpoints и заполнить `.env.yaml` найденными значениями (с явным diff и подтверждением). Это **в среднем** на каждый API сэкономит 15 минут.

4. **Skill говорит** «`--validate-schema` обязателен для CRUD» — но мой CRUD-run #9 не дошёл до single 200-ответа (всё 403 SCIM). Хорошо бы скилл явно написал «если все CRUD упали на permission/scope — это env_issue, читать `zond db diagnose --env-only` и **не** генерить case-studies».

5. **«Phase 7 — Share findings»** — хочется команду, которая по диапазону run-id одной строкой сделает bundle: `zond report bundle <run-from>..<run-to> --output triage/`. Сейчас у меня 4 run-id × 2 формата = 8 ручных команд.

6. **Нет упоминания `zond db compare`** в моём типичном flow для Phase 4. Я о нём вспомнил только из `--help`. Стоит явно прописать «после фикса прогон + compare prev_run new_run», иначе легко забыть.

## Чего точно нельзя без zond
- **Системная инвентаризация всех 219 endpoints**: catalog/resources/fixtures артефакты — на порядок удобнее, чем грепать по 3-мегабайтному spec.json.
- **Идемпотентные probe-сьюты с `always: true` cleanup'ами**: zond — единственный инструмент, где это не «дописать py-скрипт», а 3 строки YAML.
- **Связка `session_id → diagnose → case-study`**: от запуска до готового issue body — 1 минута, обычно это 15.

## TL;DR
zond сильно вытащил аудит Sentry: за ~30 минут — 7 находок, 3 из них P0/HIGH, и весь output готов к оформлению в тикеты. Главные пробелы — **probe-validation на реальных parents**, **discovery fixtures**, и **встроенные security-probes** (SSRF/CRLF). Скилл — лучший из тех, что я видел за «инструкции для ассистента», его узкое место — это не описание, а отсутствие соответствующих CLI-команд: слишком много ручного бойлерплейта, который мог бы быть `zond probe-security` / `zond discover`.
