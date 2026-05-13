# m-20 validation — competitor research + agent-augmented re-framing

Saved 2026-05-13. Источник: research-pass по конкурентам state-aware API testing + продуктовый разворот под agent-augmented workflow.

## Главный вывод

**m-20 направление подтверждено как greenfield.** Ни один конкурент не делает четыре из пяти m-20 invariant'ов целиком. Но первоначальный план m-20 нужно **переосмыслить с agent-augmented lens**: вместо строить deterministic auto-inference алгоритмы — давать **declarative yaml-конфиг** + **LLM-assisted authoring** + **human review**. Это совпадает с zond positioning (vector-5: «API testing для агентов»), снижает алгоритмическую сложность и даёт сильный отстройку от конкурентов.

## Конкуренты — карта покрытия m-20 invariant'ов

| Tool | POST→GET drift | Idempotency | Pagination | Lifecycle | Webhooks | Note |
|---|---|---|---|---|---|---|
| **Schemathesis V4** | ❌ (per-call only) | ❌ | ❌ | ❌ | ❌ | Stateful links — last-mile API, не invariant'ы |
| **EvoMaster** | implicit (coverage feedback) | ❌ | ❌ | ❌ | ❌ | JVM, search-based, opaque |
| **RestTestGen** | ❌ | ❌ | ❌ | ❌ | ❌ | Operation Dependency Graph через name-matching |
| **Akto** | ❌ | user-yaml | ❌ | ❌ | ❌ | YAML-templates модель — стоит скопировать |
| **Optic** | partial (capture-vs-spec) | ❌ | ❌ | ❌ | ❌ | Archived Jan 2026 — niche открыта |
| **Dochia** | ❌ | ❌ (blog only, no playbook) | ❌ | ⚠ (1 trivial playbook) | ❌ | См. §«Dochia deep-dive» ниже |
| **StackHawk/APIsec/Bright** | ❌ | ❌ | ❌ | ❌ | ❌ | DAST/SaaS, не contract |
| **Postman/Pact** | ❌ | ❌ | ❌ | ❌ | ❌ | Разные парадигмы |

**Greenfield**: POST→GET shape diff — никто не делает целиком. Idempotency — только Dochia, но как user-authored playbook, не auto. Lifecycle state-machine — никто. Webhook delivery в API testing tool'ах — никто (Microcks умеет в mock-mode).

## Dochia deep-dive (ARV-188, 2026-05-13)

**Главное**: Dochia казался closest competitor, но **m-20 invariant'ов у них почти нет** — реальный stateful surface = 1 trivial playbook (DELETE→GET→404). Idempotency blog post — thought-leadership marketing, не product feature (нулевой реф на idempotency в code/playbooks). Greenfield подтверждён прямой проверкой.

### Профиль
- Java native binary, Apache-2.0, **145 GitHub stars** (`github.com/dochia-dev/dochia-cli`).
- Основан Aug 2025, last release v2.1.1 (2026-04-01), monthly cadence.
- Solo/small team, organization repo один.
- Distribution: Homebrew, curl|sh, Docker.
- Open-core: OSS + Premium tier "coming soon" с advanced playbooks, **Test Execution DSL** (potential m-20 overlap, watch list), non-OpenAPI support.

### Архитектура
- **126 per-call playbooks** (field/header/body fuzzers) + **1 stateful** (`DeletedResourcesNotAvailablePlaybook`).
- Playbooks = Java classes с category-аннотациями, **не authorable пользователем** через yaml. Только через профили (yaml-bundle списков playbook'ов).
- Два command'а: `dochia test` (structured playbooks) и `dochia fuzz` (continuous fuzz duration-based).
- Config фрагментирован: `dochia.properties` + `headers.yml` + `query-params.yml` + `reference-data.yml` + `profiles.yml`.

### Что у них есть, чего нет у нас
- **`--skip-playbooks-for-extension "x-public-endpoint=true:BypassAuthentication"`** — skip rules через OpenAPI extensions в самом spec'е. Элегантно, без отдельного config file.
- **Named profiles в CLI**: `ci`, `security`, `quick`, `full`, `compliance`, `type-coercion` + yaml-override.
- **Dynamic value functions в yaml**: `#(uuid)`, `#(today)`, `#(todayPlus(30))`, `#(alphanumeric(16))`.
- **Quality-gate DSL**: `--quality-gate "errors<5,warns<20"` + `--fail-on error,warn`.
- **`init-skills` командa** для agentskills.io spec (Cursor/Windsurf/Claude Code/Codex). У нас своё через `zond init`, но их формат — open spec, стоит свериться на compatibility.

### Чего нет у Dochia
- **Никакого LLM** — code search по `openai|anthropic|claude|llm` нулевой. Agent у них **снаружи** (читает Dochia output), не **внутри** (помогает заполнить config). Это прямой контраст с нашим `zond api annotate`.
- Нет POST→GET drift, idempotency probe, pagination invariants, lifecycle, webhooks (ни одного).
- Нет resource-graph (только flat path→kv map в `reference-data.yml`).
- Нет user-authored playbooks (только Java).
- Нет multi-API workspace (один spec — один прогон).
- Anti-FP — blackbox mode "5XX only filter", не fixture-regressions.

### Что копировать в zond (2 новые ARV-задачи)
1. **`x-zond-*` OpenAPI extensions** для skip/enable rules per endpoint. Низкий cost, complements `.api-resources.yaml`. Особенно полезно как fallback когда annotate ещё не прогоняли. → ARV-NEW3.
2. **Dynamic value functions в yaml** (`#(uuid)`, `#(today)`, `#(todayPlus(N))`). Убирает stale hardcoded UUID/date traps. → ARV-NEW4.

Опционально (не задачи, но добавить в roadmap):
3. **Named profiles CLI ergonomic** — у zond уже есть `--phase`/`--check`, но explicit named profiles (`ci`, `security`, `quick`) + yaml-override стоят рассмотрения.
4. **`--quality-gate "errors<5,warns<20"`** — лучше exit-code-only модели для CI.

### От чего явно отойти
- **Не дробить config на 4 файла** (`.properties` + 3 yaml). Наш `.api-resources.yaml` + `.env.yaml` уже single-purpose-files каждый, не размазывать.
- **Не маркетить "stateful"** пока не shipped все 5 m-20 invariant'ов. Dochia переоценил один DELETE→404 как "stateful testing" — мы должны держать planку.
- **Не закрывать LLM door** — Dochia сделал явную ставку на deterministic-only. Наш agent-augmented — категорическое преимущество, не отказываться.

### Реальные advantages zond (после m-20)
1. **Actual state-aware checks** — POST→GET shape diff, idempotency probe, pagination invariants. У Dochia нулёт.
2. **Resource-graph config** — `.api-resources.yaml` с CRUD/lifecycle/idempotency semantic полями vs их flat path→kv map.
3. **Agent-augmented authoring** (`zond api annotate` LLM-pass + git-diff review) — категория, в которую Dochia не входит и явно не собирается.
4. **Anti-FP discipline** — differential baselines, strict flags, fixture regressions (ARV-183/184/186) vs их blackbox "5XX-only".

### Open watch items
- Premium "Test Execution DSL" — может быть stateful sequencing language. Re-check когда launch.
- Парсят ли OpenAPI `links` (не документировано). Source-read `OpenAPIModelGenerator.java` если важно.
- Расширится ли их `x-extension` pattern на enable (не только skip) — `x-idempotent=true` opt-in. Watch для нашего ARV-NEW3 дизайна.

## Agent-augmented testing — что уже есть

Релевантный research в академии (январь 2026):

- **AutoRestTest** (IBM, ICSE 2025) — multi-agent RL + LLM с Semantic Property Dependency Graph. 4 кооперирующих агента (API/dependency/parameter/value).
- **KAT** (Katalon, 2024) — LLM выводит operation dependencies из spec descriptions вместо хрупкого name-matching.
- **OOPS** (Jan 2026) — LLM генерирует OpenAPI spec с dependency graph.

**Паттерн**: LLM заменяет brittle name-matching heuristics для resource-graph inference. **Никто ещё не shipping** LLM-driven idempotency/pagination/lifecycle probe'ов.

## Agent-augmented re-framing m-20

### Старая модель (deterministic-auto)

Каждый probe: «прочитай spec → детектируй pattern алгоритмом → пробуй → assertи». Проблемы:

1. **Algorithmic complexity** растёт линейно с количеством паттернов (cursor vs page vs offset vs token). Каждый API имеет вариации.
2. **False positives** на API-quirks (Stripe `metadata` стрипится — это норма, не bug; алгоритм не знает).
3. **Brittle name-matching** для resource-graph inference (RestTestGen weakness).
4. **Lifecycle инвариант** в принципе не выводится из spec'а алгоритмически — он живёт в descriptions.

### Новая модель (yaml-declarative + LLM-assisted-authoring + human-review)

Каждый probe: «прочитай `.api-resources.yaml` → пробуй per declared config → assertи». Inference вынесен в отдельную команду `zond api annotate`, которая использует LLM для draft'а yaml-конфига, **который человек ревьюит** перед запуском.

```
.api-resources.yaml:
  resources:
    subscription:
      lifecycle:
        field: status
        transitions: [...]
      idempotency:
        header: Idempotency-Key
        body_hash_fields: [amount, currency]
      pagination:
        type: cursor
        cursor_field: starting_after
        has_more_field: has_more
      readback_diff:
        ignore_fields: [created, updated_at, livemode]
        write_to_read_map:
          tax_id_data: tax_ids  # write-shape → read-shape
```

И команды:

```
zond api annotate --lifecycle [--api stripe]    # LLM-pass, fills lifecycle блок
zond api annotate --idempotency
zond api annotate --pagination
zond api annotate --readback                    # detect ignore_fields из sample runs
zond probe state-aware --api stripe             # запускает все по yaml
```

Human review:
- `zond api annotate` пишет в `.api-resources.local.yaml` (overlay через ARV-111)
- diff показывается, человек approves через git review

### Что это даёт

1. **Алгоритмически просто.** Каждый probe — это yaml-reader + few-line check, не паттерн-детектор.
2. **Anti-FP first.** API-quirks (Stripe `metadata`) кладутся в `ignore_fields` через annotate или вручную. Probe не видит ничего, что не объявлено.
3. **LLM как фича, не обуза.** Пользователь может **или** руками заполнить yaml, **или** запустить annotate. И там и там — review.
4. **Уникальное конкурентное позиционирование.** AutoRestTest/KAT делают LLM inference, но не дают user-review слой. Akto даёт declarative yaml, но без LLM-authoring. Dochia — playbooks, но без LLM. Мы — единственные с тремя слоями (declarative + LLM + review).
5. **Соответствие vector-5** («API testing для агентов и через агентов»).

## Что меняется в задачах m-20

**Без изменений** (yaml-driven уже заложено):
- **ARV-172** lifecycle — уже declarative. LLM-pass `zond api annotate --lifecycle` ложится естественно.
- **ARV-173** webhooks — recipe + probe, agent-lens не сильно меняет.

**Требуют переосмысления** (auto-detect → yaml-declarative):
- **ARV-169** cross-call drift — добавить `readback_diff` блок в yaml: `ignore_fields`, `write_to_read_map`. По умолчанию — auto-derived из spec (если есть), override через yaml.
- **ARV-170** idempotency — meta-флаг `idempotent: true` → расширить до полного блока с `header`, `body_hash_fields`, `replay_timeout`.
- **ARV-171** pagination — schema-detection дополнить declarative `pagination` блоком в yaml.

**Новые задачи**:
- **ARV-NEW1**: `zond api annotate` infrastructure — общий LLM-pass writer в `.api-resources.local.yaml` с diff/review/approve flow.
- **ARV-NEW2**: deep-dive Dochia (closest competitor) — что именно их idempotency playbook делает, что мы можем перенять.

## Что сохраняем из старого плана

- Done-критерии m-20 (5 пунктов) — без изменений по содержанию.
- Принципы «spec/manifest first», «anti-FP first», «recipes для нестандартного», «skill catch-up» — без изменений.
- Гипотеза о размере (+30..50 cross-call findings на Stripe) — валидна.

## Что добавляем в принципы m-20

- **Agent-authored yaml как first-class workflow.** Каждый m-20 probe имеет соответствующий `zond api annotate --<aspect>` command. Без annotate — пользователь пишет yaml руками; с annotate — LLM пишет draft, человек ревьюит через git diff.
- **Algorithmic minimalism.** Если detection требует >100 строк pattern-matching кода — выносится в `annotate` LLM-pass, не в core probe.
- **Review boundary.** LLM пишет только в `.local.yaml` overlay, никогда не в основной `.api-resources.yaml`. Это даёт чёткую границу «что от LLM, что от человека».

## Risks

- **LLM cost / availability**. annotate-команды требуют API key (или local Ollama). Принципиально optional — yaml можно писать руками.
- **LLM quality**. Если annotate выдаёт мусор — `ignore_fields` неполный → FP. Mitigation: human review через git diff, fixture-tests на anti-FP regression.
- **Spec descriptions quality**. Lifecycle inference опирается на качество descriptions в spec'е. Stripe/GitHub хорошие; маленькие API — плохие. Mitigation: fallback на «человек пишет yaml».

## Решение

1. m-20 **запускается** в обновлённой форме (agent-augmented yaml-driven).
2. Создать ARV-NEW1 (annotate infrastructure) — параллельный track с probe'ами, не блокер.
3. Создать ARV-NEW2 (Dochia deep-dive) — research-задача до начала ARV-169.
4. Обновить ARV-169/170/171 описания с new yaml-blocks (см. §«Что меняется»).
5. m-20 milestone обновить с reference на этот доку.

## Следующий шаг

Начинать рекомендую с **ARV-NEW2 (Dochia deep-dive, 1-2 часа)** → потом **ARV-169 (cross-call drift)** как самый высокий ROI пункт m-20. ARV-NEW1 (annotate) — параллельный track, можно делать после первого probe, когда вырисуется структура yaml-блоков.
