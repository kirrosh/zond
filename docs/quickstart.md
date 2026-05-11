# Быстрый старт: покрытие API тестами через AI-агента

AI-агент (Claude Code) + zond = автоматическое покрытие вашего API тестами по OpenAPI-спецификации. Вы даёте задание на естественном языке, агент сам генерирует тесты, запускает их и показывает результаты в терминале.

---

## Что понадобится

- **Claude Code** — CLI-инструмент от Anthropic (установим ниже; для него потребуется Node.js 18+)
- **OpenAPI-спецификация** вашего API — файл `openapi.json` или `openapi.yaml`, либо URL

> Сам zond — нативный бинарник, Node.js ему не требуется (см. установку ниже).

---

## Шаг 1. Создать папку проекта

Создайте отдельную папку — в ней будут храниться тесты, конфигурация окружения и база данных с результатами запусков.

```bash
mkdir my-api-tests
cd my-api-tests
```

Скопируйте сюда OpenAPI-спецификацию вашего API (или запомните URL, где она доступна):

```bash
cp ~/path/to/openapi.json .
```

---

## Шаг 2. Установить и запустить Claude Code

> Если Claude Code уже установлен — пропустите установку и переходите к запуску.

Установите Claude Code глобально (один раз). Подробная инструкция по установке и настройке: [code.claude.com/docs/en/setup](https://code.claude.com/docs/en/setup)

```bash
npm install -g @anthropic-ai/claude-code
```

Запустите с флагом автоматического подтверждения всех действий:

```bash
claude --dangerously-skip-permissions
```

> **Что делает этот флаг?** Обычно Claude Code спрашивает разрешение на каждое действие — создание файлов, запуск команд и т.д. С этим флагом агент работает автономно, без ручных подтверждений. Используйте его только в изолированных папках, где нет важных данных.

---

## Шаг 3. Подключить zond

Установите бинарь zond (если ещё не установлен):

```bash
curl -fsSL https://raw.githubusercontent.com/kirrosh/zond/master/install.sh | sh
```

Инициализируйте workspace и зарегистрируйте API (двумя командами — это
канонический путь начиная с m-13):

```bash
zond init                                  # создаёт zond.config.yml, AGENTS.md, .claude/skills/
zond add api myapi --spec openapi.json     # копирует spec.json + строит 3 артефакта
zond use myapi                             # делает myapi активным (можно опустить --api ниже)
```

После `zond init` агенты Claude Code / Cursor подхватят `AGENTS.md` и
скиллы из `.claude/skills/` автоматически — никакого MCP-сервера или
веб-сервиса не требуется (см.
[decision-2](../backlog/decisions/decision-2%20-%20Drop-MCP-server-—-keep-CLI-agent-skills-as-the-only-integration-surface.md)).
CLI — единственная поверхность интеграции.

---

## Шаг 4. Дать задание агенту

Дайте агенту первое задание на естественном языке — сгенерировать
безопасные smoke-тесты (только GET-запросы, которые не меняют данные):

```
Покрой openapi.json безопасными smoke-тестами и запусти их.
```

> **Что произойдёт?** Агент пойдёт по фазам, описанным в скилле `zond.md`:
>
> 1. `zond doctor --api myapi --missing-only` — gap-отчёт: какие vars в `.env.yaml` UNSET и сколько endpoint'ов каждый блокирует
> 2. `zond prepare-fixtures --api myapi --apply [--seed]` — заполнит FK-ids из live-API; `--seed` POST-создаст ресурс, если list endpoint вернул `[]`
> 3. `zond generate` — сгенерирует YAML-сьюты в `apis/myapi/tests/`
> 4. `zond run apis/myapi/tests --safe` — запустит только GET-запросы
> 5. Покажет сводку: сколько тестов прошло, сколько упало и почему
>
> Важно: `zond init` (шаг 3 выше) **не трогает** `.env.yaml` — он лишь
> обновляет workspace-файлы (skills, AGENTS.md, zond.config.yml).
> Заполнением `.env.yaml` занимается только цикл `doctor` →
> `prepare-fixtures` выше.

Хотите запустить весь pipeline одной командой? `zond audit --api myapi`
делает шаги 2–4 + probes + coverage + HTML-отчёт за один проход
(TASK-262).

---

## Шаг 5. Настроить авторизацию

Если ваш API требует авторизации, часть тестов упадёт с `401 Unauthorized`.
Агент увидит это и спросит токен. Есть два варианта:

### Вариант А: Сказать агенту прямо в чате

```
Токен для авторизации: Bearer sk-your-token-here
Сохрани его в .env.yaml и перезапусти упавшие тесты.
```

### Вариант Б: Отредактировать файл вручную

После шага 4 агент создал файл `apis/myapi/.env.yaml`. Откройте его и
добавьте токен (или ссылку на секрет в `.secrets.yaml`):

```yaml
base_url: https://api.example.com
auth_token: Bearer sk-your-token-here
# либо: auth_token: { secret: api.token }   # ссылка на .secrets.yaml
```

Затем попросите агента перезапустить тесты:

```
Перезапусти упавшие тесты с обновлённым окружением.
```

> **Важно:** `.env.yaml` и `.secrets.yaml` автоматически добавлены в
> `.gitignore` — токены не попадут в git. zond также авто-редактирует
> зарегистрированные секреты во всех артефактах (HTML-отчёт, JUnit, JSON,
> SQLite results-таблица — m-10).

---

## Шаг 6. Посмотреть результаты

zond не имеет веб-UI (TASK-284) — все артефакты живут локально и в SQLite.
Несколько способов посмотреть, что произошло:

```bash
zond db runs --limit 5                    # последние 5 прогонов
zond db diagnose                          # триаж последнего failing-run (в терминал)
zond db diagnose <run-id> --json          # тот же триаж, машино-читаемо
zond report export <run-id> -o report.html   # один HTML-файл — открыть в браузере
zond report bundle <id-from>:<id-to>      # пакетный экспорт (HTML + markdown + index)
zond coverage --api myapi                 # pass-coverage / hit-coverage табличкой
```

Команда `zond db diagnose` — главный инструмент триажа. Она классифицирует
каждое падение по `recommended_action` (например, `fix_env`,
`fix_fixture`, `report_backend_bug`) и подсказывает следующий шаг.
Подробнее — скилл `.claude/skills/zond-triage.md`.

---

## Что дальше

После smoke-тестов агент может выполнить более сложные задачи. Примеры
промптов:

### Покрытие

```
Сделай coverage-анализ — какие эндпоинты не покрыты тестами?
```

> Агент вызовет `zond coverage --api myapi --json` и сводит результат:
> процент pass-coverage, hit-coverage, список непокрытых эндпоинтов и
> three-bucket разбивку (`covered2xx` / `coveredButNon2xx` / `unhit`,
> TASK-280).

### Триаж упавших тестов

```
Посмотри на упавший последний прогон, разберись в чём проблема, предложи правки.
```

> Агент вызовет `zond db diagnose --json`, прочитает
> `recommended_action` каждого падения и направит работу: `fix_env` →
> правка `.env.yaml`; `fix_fixture` → `zond prepare-fixtures --apply`;
> `report_backend_bug` → пакетный case-study через `zond report bundle`.

### Покрыть CRUD-операции

```
Сгенерируй CRUD-тесты для всех эндпоинтов и запусти, не оставляя данных в API.
```

> `zond generate` сам строит цепочки create → read → update → delete с
> автоматическим cleanup (TASK-79). Агент может запустить с `--dry-run`
> для предпросмотра запросов без отправки.

### Security-аудит

```
Прогон probe security и mass-assignment — какие endpoint'ы уязвимы?
```

> `zond probe security` запускает SSRF / CRLF / open-redirect probes;
> `zond probe mass-assignment` ищет privilege-escalation. Оба — live (с
> `--isolated` для security-probe — защита seeded fixtures, TASK-264).

### Сравнить два запуска (регрессия)

```
Сравни последний прогон с предыдущим: что сломалось, что починилось?
```

> Агент вызовет `zond db compare <idA> <idB>` и покажет регрессии и
> восстановления.

### Добавить тесты в CI/CD

```
Сгенерируй GitHub Actions конфиг для прогона zond на каждом PR.
```

> Агент вызовет `zond ci init --github` и создаст
> `.github/workflows/zond.yml`. В CI используйте `zond run --all`
> (TASK-116) — он автоматически забирает `commit_sha` / `branch` /
> `trigger=ci` из env и пишет один общий run на всё CI-инвокацию.

---

## Итого: что получится

```
my-api-tests/
├── zond.config.yml         ← дефолты (timeout, rate-limit) — TASK-301
├── zond.db                 ← SQLite с результатами всех прогонов
├── .zond/
│   ├── current-api         ← активный API (выставлен `zond use`)
│   └── manifest.json       ← реестр авто-генерируемых файлов (`zond clean` ориентир)
└── apis/
    └── myapi/
        ├── spec.json       ← снепшот OpenAPI-спецификации
        ├── .api-catalog.yaml      ← компактный реестр эндпоинтов
        ├── .api-resources.yaml    ← CRUD-связи между ресурсами
        ├── .api-fixtures.yaml     ← MANIFEST: список required {{vars}} (read-only)
        ├── .env.yaml       ← VALUES: base_url, токены, FK-фикстуры
        ├── .secrets.yaml   ← сами секреты (опционально)
        └── tests/
            ├── smoke.yaml          ← GET-тесты
            └── <resource>-crud.yaml ← CRUD-сьюты
```

Все тесты — обычные YAML-файлы, которые можно редактировать вручную,
хранить в git и запускать в CI.
