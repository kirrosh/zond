# zond — снимок возможностей (v0.26.1, 2026-07-09)

Собрано для решения «куда следующий шаг»: добивать паритет со Schemathesis / конкурентами
или искать новый вектор. Ниже — что в zond есть **сейчас** и как он работает.

---

## 1. Что такое zond в одной картинке

zond — **детерминированный «тупой» инструмент** (dumb-tool). Он никогда не зовёт LLM.
Весь loop:

```
zond dump (факты) → агент думает (severity/вина/FP/выдумать fixture) → агент apply YAML → zond execute
```

Литмус-тест (`src/CLAUDE.md`): *детерминировано* (послать запрос, свалидировать схему, diff,
выдать enum-подсказку) → в zond; *суждение* (severity, вина, «это FP?», изобретение fixture,
многопроходный discovery) → агенту.

**Позиционирование (decision-8, не менялось через пивот):** API hygiene scanner для маленьких
команд (5–20 разработчиков без выделенного security-инженера), как pre-release baseline.
Явно **НЕ**: bounty-tool, конкурент Burp/Caido/Akto, «schemathesis killer», основной «AI-output verifier».

Принцип severity: **no evidence → no HIGH**. CRITICAL только на end-to-end exploit-chain,
HIGH только на evidence-chain ≥2 запросов. Категории вместо счётчиков (security / reliability /
contract / hygiene). «Тишина» — валидный исход пробы.

---

## 2. Свежая архитектурная история (важно для «следующего шага»)

**m-24 «lightening pivot» (decision-9, 2026-07-06, зашипано в v0.25.0).** После evidence-run
на GitHub/Stripe выяснилось: полезные находки по API — редкие и аккуратные, а собственный
поток багов zond концентрировался целиком в **автономном эвристическом слое**. У каждой
эвристики — бесконечный хвост edge-case'ов. Решение: срезать «умный автономный» слой,
отдать все суждения агенту (он теперь надёжен в петле).

**Удалено (v0.25.0):**
- Автономный fixture seed/cascade движок (`bootstrap.ts` + `create-body.ts` — угадывал тела
  POST и каскадил parent→child; 1% успеха на Stripe). `prepare-fixtures` теперь single-pass
  verify + gap-report, не POST-ит и не харвестит.
- Калибраторы severity + anti-FP suppression gate (severity теперь суждение агента).
- `annotate auto` guess-engine (`inferSeedBody` фабриковал тела из format/name).
- Auto-`discovery`, который совал числовой repo-id в login-слот (`owner`) → артефакт с 5% покрытия,
  из-за которого и затеяли пивот.

**Оставлено (детерминированное ядро):** послать запрос + записать run; валидация схемы;
движок checks/probes как *инструмент* (агент решает что гонять); coverage/diff как сравнение
run'ов (+ field-level `db compare`); YAML-summary (`db diagnose --report yaml`);
agent-orchestrated seed (`request --capture` + skill `zond-seed`).

**Остаточные эвристики (m-25, ещё не дочищены):** `discover.ts` (1356 строк, ARV-362),
`path-discovery.ts` (ARV-363), `data-factory.ts` (сузить до `generate`), `severity/`
(решить: opt-in tool или срезать).

**m-25 (текущая, v0.26.x):** дочистка остаточных эвристик + пивот в **дистрибуцию/упаковку**
(npm bin + brew tap, cold-start `init`, README v2) + skill `warm-up-target` для подъёма honest-2xx.

---

## 3. Ядро: чеки, пробы, stateful (что реально ловит)

### 3.1 Depth-checks (Schemathesis-V4-aligned) — `zond checks run`

Имена 1-в-1 повторяют Schemathesis V4 (осознанная узнаваемость).

**Per-response checks:**

| id | severity | что ловит |
|---|---|---|
| `not_a_server_error` | high | любой 5xx на корректный запрос |
| `status_code_conformance` | low | статус не задекларирован в spec `responses` |
| `content_type_conformance` | medium | Content-Type ответа не из задекларированных |
| `response_headers_conformance` | low | задекларированные заголовки ответа отсутствуют/битые |
| `response_schema_conformance` | high | тело ответа не проходит OpenAPI-схему |
| `missing_required_header` | high | сервер принял запрос с выкинутым required-заголовком |
| `unsupported_method` | medium | незадекларированный HTTP-метод не отбит (405/401/403/404) |
| `negative_data_rejection` | low | невалидное тело не отбито |
| `positive_data_acceptance` | medium | валидное сгенерированное тело отвергнуто (400/422) |
| `rate_limit_headers_absent` | medium | мутирующий эндпоинт без `X-RateLimit-*`/`Retry-After` (OWASP-API-04) |

**Stateful checks** (многозапросные цепочки, `--check stateful`):

| id | фаза | severity | что ловит |
|---|---|---|---|
| `ignored_auth` | auth | low | запрос без/с битой авторизацией не отбит |
| `open_cors_on_sensitive` | auth | high | эхо произвольного Origin + `Allow-Credentials: true` (OWASP-API-09) |
| `use_after_free` | crud | high | GET удалённого ресурса не 404/410 |
| `ensure_resource_availability` | crud | medium | GET только что созданного ресурса не 2xx |
| `cross_call_references` | crud | low | поля из POST не читаются через GET (shape-diff) |
| `idempotency_replay` | crud | high | два POST с одним `Idempotency-Key` дают разный id/ответ |
| `pagination_invariants` | crud | low | страницы курсора пересекаются / `has_more` врёт |
| `lifecycle_transitions` | crud | high | lifecycle-действия не двигают ресурс по задекларированным состояниям |
| `cursor_boundary_fuzzing` | crud | low (5xx→high) | битый курсор даёт 5xx вместо 4xx |

Оркестрация: `--phase examples|coverage|all`, `--mode positive|negative|all`, windowed-sweeps
(`--skip-ops/--max-ops`), `--workers`, safe-by-default (мутации сами скипаются), per-op
`x-zond-skip`/`x-zond-public`. Broken-baseline guard (ARV-307): если позитивный baseline
вырожден (>90% не-2xx) — сворачивает в один rollup вместо шума.

### 3.2 Probes (live-атаки) — `zond probe <class>`

- **`static`** — без live-трафика, генерит YAML-сьюты: `validation` (битые типы/значения) +
  `methods` (незадекларированные методы).
- **`mass-assignment`** — live, инъекция privilege-полей (`is_admin`, `role`, `account_id`…),
  вердикт per-field: `applied` (HIGH) / `ignored` (LOW) / `echoed-overwritten` / `absent`.
  Baseline-first → follow-up GET → cleanup-DELETE + orphan-tracking.
- **`security`** — live SSRF / CRLF / open-redirect. Spec-driven детект полей (name-regex +
  `format: uri/url`), фиксированные payload'ы (`169.254.169.254` metadata, `file:///etc/passwd`,
  CRLF header-injection). Baseline-OK gate + карта cleanup-feasibility.
- **`webhooks`** — валидирует захваченные event-логи против 3.1 `webhooks:` (shape_drift,
  unknown_event_type, missing_payload, malformed_event).

Live-пробы пишут orphan-трекер в `~/.zond/orphans/` → чистятся `cleanup --orphans`.

### 3.3 Классификация и enum

Единый закрытый `recommended_action` (по нему агент роутит, никогда по тексту сообщения):
`report_backend_bug | fix_auth_config | fix_test_logic | fix_network_config | fix_env |
fix_spec | fix_fixture | regenerate_suite | tighten_validation | add_required_header |
wontfix_known_limitation`.

---

## 4. Данные и артефакты (workspace-контракт)

Один API = каталог `apis/<name>/` с 5 файлами:

| файл | роль | кто пишет |
|---|---|---|
| `spec.json` | снапшот OpenAPI | zond (refresh-api) |
| `.api-catalog.yaml` | компактный справочник эндпоинтов | zond |
| `.api-resources.yaml` | ресурсы, FK-зависимости, CRUD-группы | zond |
| `.api-fixtures.yaml` | **MANIFEST** — список vars (source-of-truth, read-only) | zond |
| `.env.yaml` | только **VALUES** (editable руками) | пользователь/агент |

Overlay агента: `.api-resources.local.yaml` (readback/idempotency/pagination/lifecycle config),
`.api-schema.local.yaml` (через `refresh-api --merge-schema`), hand-written `scenarios/*.yaml`.
Приоритет: local-overlay > `x-zond-*` extensions > baseline `.api-resources.yaml` > дефолты.

**Формат спеков:** OpenAPI **3.0 и 3.1** (дереференс через `@readme/openapi-parser`).
Quirk-fixers: reconcile path-param имён, disambiguate generic `{id}`/`{slug}`, text-based
deprecation, `allOf` merge.

**Переменные/интерполяция:** `{{var}}`, генераторы `$uuid/$timestamp/$random*` (в т.ч.
format-aware `$randomCountryCode/CurrencyCode/MCC/...`), env-cascade (deeper wins),
`${SHELL_VAR:-default}`, dynamic `#(uuid)/#(today)/#(todayPlus(N))`, `@secret:` (auto-redact),
`@identity:`.

**DB:** SQLite (`.zond/zond.db`, WAL). Таблицы `runs/results/collections/settings/lint_runs`.
`run_kind`: `regular|probe|check|request|fixture`. Заморожены spec-evidence колонки
(`spec_pointer`, `spec_excerpt`, `provenance`, `captures`, `assertions`). Retention:
non-regular >7d чистятся, `regular` — навсегда.

---

## 5. Reporting и coverage

- **Форматы run:** `console`, `json`, `junit`; NDJSON event-stream; **SARIF v2.1.0** для
  GitHub Code Scanning (rule-дескрипторы на каждый чек, стабильные fingerprints,
  byte-identical между прогонами); HTML/markdown экспорт (`report export/bundle`).
- **Coverage — dual-metric:**
  - **test-coverage** — pass/hit только из `run`+probe.
  - **audit-coverage** — любой HTTP-touch из run/checks/probe/request/prepare-fixtures.
  - Матрица: строки `METHOD path` × колонки `2xx|4xx|5xx`, ячейка `covered|partial|uncovered`
    с ReasonCode (`no-fixtures`, `deprecated`, `ephemeral-only`, `auth-scope-mismatch`…).
  - **honest-2xx** — реально пройденный 2xx (не синтетический 404-плейсхолдер), капается
    пустым состоянием таргета, поднимается seeding'ом реальных fixture.
- CI-gate: `coverage --fail-on-coverage N`.

---

## 6. Полная CLI-поверхность (по группам)

**Setup:** `init` · `add api` · `remove api`(rm) · `use` · `secrets set` · `refresh-api` ·
`doctor` · `clean` · `cleanup --orphans`

**Generate:** `generate` · `prepare-fixtures` · `fixtures add/import` · `api annotate dump/apply`

**Run:** `run` (богатейший набор флагов: `--safe`, `--validate-schema`, `--learn`, `--union`,
селекторы include/exclude, `--max-requests`…) · `session start/end/status/list` · `request`

**Analyze:** `coverage` · `db collections/runs/run/diagnose/compare/stats/prune` · `describe` ·
`audit` (breadth-макрос, safe-by-default) · `check tests/spec` + `lint` · `checks list/run` ·
`probe static/mass-assignment/security/webhooks`

**Report:** `report export/bundle` · `catalog`

**Other:** `ci init` (github/gitlab) · `completions` · `reference random-helpers` · `schema-from-runs`

Все leaf-команды (кроме `run` и `completions`) отдают `--json` с envelope
`{ok, command, data, warnings, errors, exit_code}`. Exit-коды: 0 ok · 1 findings/failures ·
2 usage/input · 3 internal.

---

## 7. Агентский слой (5 skills + workflow)

Ставятся `zond init` в `.claude/skills/`:

| skill | триггер | что делает |
|---|---|---|
| **`zond`** | любой touch workspace / «audit this API» | 10-фазный workflow: orient → fixtures → annotate → generate → lint → run → stateful → probes → coverage → share |
| **`zond-checks`** | «deep audit», «SARIF», «stateful invariants» | depth-чеки, аннотейт-flow для stateful, SARIF/ndjson |
| **`zond-triage`** | «что упало в последнем run» | read-only, роутит строго по `recommended_action` enum |
| **`zond-seed`** | `unseededRoots`, «create test data» | agent-reasons/zond-executes seed-loop (не удалённый blind-cascade) |
| **`warm-up-target`** | honest-2xx застрял ~30% | агент греет таргет его же SDK/CLI (issue_id, file_id, OAuth) → харвест live-id |

**Workflow `zond-audit`** (`.claude/workflows/zond-audit.js`) — замена ralph-loop, 3 фазы
(Setup → Depth windowed-sweep → Triage), ключ только через env `ZOND_TEST_API_KEY`,
на выходе `report-api.md` (находки, severity ставит агент) + `report-zond.md` (фидбэк по самому zond).

Контракты: **ZOND.md** (полный CLI-референс), **AGENTS.md** (workspace-контракт, cardinal rule
manifest-vs-values), **SOYUZ.md** (семейная доктрина dump→reason→apply, сравнение со Schemathesis/Dredd/42Crunch/Postman/Spectral/Burp).

---

## 8. Конкуренты и паритет (что уже известно)

- **Schemathesis** — главный референс, измеряется, не «догоняется». m-18 (закрыт 2026-05-13):
  количественный diff на Sentry/Stripe/Resend, вердикт — **архитектурный паритет по 8 из 12
  чеков**, zond **лучше по param-axis coverage**. Решение по fuzz-движку **отложено** (ARV-182).
- **Рынок «полной валидации» — переполнен** (Postman, Bruno, Schemathesis, ReadyAPI, Total
  Shift Left). «Hygiene scanner с no-evidence-no-high severity» назван **незанятой нишей** —
  явная причина *не* пивотить в общий валидатор (m-23, 2026-05-18).
- **Burp/Caido/Akto** — bounty-инкумбенты, с которыми zond осознанно **не** конкурирует.
- **Dochia** (restler-adjacent, idempotency/stateful) — источник идей, не позиционный конкурент.

**Явно вне scope (decision-8 + §3.3):** MCP-сервер, WebUI/`zond serve`, Postman-экспорт,
OOB/interactsh, bounty-mode, BOLA/RBAC two-account matrix, race-as-security, GraphQL,
pytest-плагин, self-update.

---

## 9. Открытый backlog (6 задач To Do) — где сейчас граница

Всего 353 задачи (347 Done). Открыты два кластера:

**Баги генератора/fixture:**
- ARV-373 — path-param схлопывает 5 разных byid-ресурсов в один `byid_id`.
- ARV-374 — derivation имени ест version-сегмент на `/api/<resource>/v{N}/{id}` (`v30_id`).

**Форвардная работа m-25:**
- ARV-370 — новый чек `error_response_disclosure` (утечка stack-trace в теле ошибки). *(security)*
- ARV-371 — новый чек: query-параметры, помеченные optional в спеке, но фактически required сервером. *(contract-drift)*
- ARV-365 — package & publish (npm bin + brew tap + cold-start `init` для чужого репо). *(дистрибуция)*
- ARV-367 — on-prem/enterprise onboarding (corp CA spec-fetch + apiKey hint). *(дистрибуция)*

**Единственная реально форвардная product-поверхность — два новых класса чеков (ARV-370/371).**
Остальное открытое — либо bug-cleanup, либо дистрибуция/онбординг. Schemathesis fuzz-engine
остаётся явно отложенным.

---

## 10. Вывод для решения «следующий шаг»

Три наблюдения, на которых строится развилка:

1. **Паритет со Schemathesis уже почти закрыт** (8/12 чеков, лучше по param-axis) и по стратегии
   *измеряется, а не догоняется*. Дальше догонять — это fuzz-engine (ARV-182, отложен) и
   stateful-links. Это добьёт «инженерный» паритет, но играет на **переполненном** поле.

2. **Ниша уже выбрана и незанята** — «hygiene scanner, no-evidence-no-high, для маленьких
   команд». Форвардный вектор внутри неё — **новые детерминированные классы чеков**, которые
   ложатся в литмус-тест (ARV-370 stack-trace disclosure, ARV-371 optional-but-required —
   оба contract/hygiene, а не fuzz).

3. **m-25 уже голосует за дистрибуцию** (ARV-365/367): продукт технически зрелый, но у чужого
   инженера нет пути «поставил и погнал». Это не «фича», это **условие, чтобы ниша вообще
   увидела инструмент**.

Развилка не «паритет vs новый вектор», а скорее: **добить дистрибуцию** (чтобы ниша заработала)
+ **растить чек-каталог в сторону hygiene/contract-drift** (уникальное), *не* уходя в
fuzz/bounty-поле, где ждут зрелые инкумбенты.
