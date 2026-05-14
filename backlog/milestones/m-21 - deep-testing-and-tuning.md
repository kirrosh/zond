---
id: m-21
title: "deep-testing-and-tuning"
---

## Description

После m-20 (state-aware contract layer) инфраструктура для cross-call invariant'ов
shipped: 5 probe-classов (`cross_call_references`, `idempotency_replay`,
`pagination_invariants`, `lifecycle_transitions`, webhook recipe) + 6 подкоманд
`zond api annotate` (dump+apply, no LLM inside zond). Skill-каталог обновлён.

Но **эмпирический сигнал тонкий**: на Stripe test API 57/69 кейсов
`cross_call_references` skipped из-за broken-baseline 400 — probe не успевает
дойти до assert. Resend узкий. Sentry заблокирован FK-резолюцией. Итог: probes
работают, но валидированы на узкой поверхности с враждебным test mode.

m-21 — это **deep testing + tuning** этап перед тем как двигаться в fuzz engine
(m-22+) или BOLA-matrix (vector-2 stage 3). Цель — расширить empirical-surface
m-20 probes и убрать главный bottleneck (fixture data-quality), чтобы каждый
следующий probe-class начинался не с потолка `25/69 path-FK filled`.

## Источники

### Эмпирика m-20 close-out (ARV-192, 2026-05-13)
- `backlog/notes/m-20-validation.md` §Closure — almetric таблица + done-criteria
  статус. cross_call 2/3 с задокументированным ceiling.
- Stripe seed: 25/69 path-FK после prepare-fixtures `--seed --apply` + 17
  annotated seed_body. Остальные POST → 400 даже с валидным body (Stripe
  form-encoding nested params, required-fields в test mode, balance/Connect
  зависимости).
- Sentry orphans: 108 endpoints. Stripe orphans: 281. **0 high-confidence
  новых CRUD-resources** — все lifecycle actions на каталогизованных
  ресурсах либо singleton/read-only.

### Стратегия
- `strategy/strategy.md` §2 «Depth» — m-21 закрывает gap между «m-20 shipped»
  и «fuzz/BOLA-matrix начался».
- Без m-21 любой следующий probe-class будет страдать тем же data-quality
  ceiling — это блокер не алгоритмический, а инфраструктурный.

## Цели майлстоуна

### A. Controlled testbed с regression-floor

1. **Mock-API с заранее известными багами** (ARV-NEW3). Поднять локальную
   API (Microcks / Prism / Wiremock) с намеренно сломанными invariant'ами:
   POST→GET drift, off-by-one pagination, лживый idempotency, неконсистентный
   lifecycle. Прогнать m-20 probes — они **должны** найти всё. Это даёт
   **regression-floor** для probe-quality, которого сейчас нет.

### B. Расширение API-зоопарка

2. **Добавить ≥2 публичных API** (ARV-NEW4): Linear / GitHub / Shopify.
   Personal-token auth, более permissive seed. Прогнать m-20 probes,
   зафиксировать findings. Без этого probes валидируются только на одном
   hostile API (Stripe).

### C. Fixture-bootstrap UX

3. **`zond fixtures add` + dashboard-import** (ARV-NEW5). 25/69 path-FK —
   это потолок prepare-fixtures `--seed`. Нужен явный путь для ручного
   bootstrap'а: либо `zond fixtures add <var>=<id>` (с GET-validate как
   ARV-32), либо `zond fixtures import --from-curl` (paste curl команд из
   dashboard), либо `zond fixtures import --from-postman`.

### D. Stripe form-encoding fix

4. **Nested form params** (ARV-NEW6). prepare-fixtures `--seed` POSTит body
   как flat key/value. Stripe требует `card[number]`, `items[0][price]`,
   `enabled_events[0]` — bracket notation. Корневая причина 57/69
   broken-baseline на Stripe `cross_call_references`. Исправить
   serializer + добавить annotated примеры.

### E. Security-вектор: OOB-oracle

5. **`probe security --oob-server`** (ARV-177, уже в backlog). interactsh
   OOB-oracle для SSRF. Хорошо ложится в формат recipes, открывает
   следующий security-класс после m-20.

### F. Spec-driven config polish

6. **`x-zond-*` OpenAPI extensions** (ARV-189). Skip/enable rules per
   endpoint прямо в spec'е (паттерн Dochia). Низкий cost, complements
   `.api-resources.yaml`.
7. **Dynamic value functions** (ARV-190). `#(uuid)`, `#(today)`,
   `#(todayPlus(N))` в yaml. Убирает stale hardcoded UUID/date traps.

## Не покрывает

- **Fuzz engine + auto-shrinker** — m-22+. m-21 fortifies m-20 ground;
  fuzz layer строится поверх.
- **BOLA/RBAC matrix** — m-22+. m-21 — single-tenant invariants на
  расширенной поверхности.
- **Performance/latency probes** — vector-6. m-21 — correctness, не perf.
- **Race / concurrency** — vector-6.

## Принципы

- **Mock first, prod second.** Каждый m-20 probe в m-21 валидируется на
  controlled testbed ДО реального API. Без mock-floor finding из prod —
  неподтвержденный сигнал.
- **Empirical-surface > algorithmic-depth.** m-21 не добавляет новых
  probe-классов (это m-22). Цель — каждый существующий probe прогнать
  на ≥3 API с не-нулевой data-quality.
- **Fixture-bootstrap как first-class UX.** Если probe не доходит до
  assert из-за фикстур — это UX-проблема zond, не пользователя. m-21
  делает bootstrap явным.
- **Anti-FP first** (наследуется из m-20). Каждая новая фикстура /
  testbed-баг покрывается regression-fixture.

## Done-критерий

1. **Mock-testbed с ≥4 intentional bugs**, прогон m-20 probes находит
   100% (4/4). Fixture-теcт в `tests/` валидирует.
2. **≥2 public APIs добавлены** в `apis/` (Linear/GitHub/Shopify).
   m-20 probes прогнаны, findings/PASS зафиксированы в
   `backlog/notes/m-21-validation.md`.
3. **`zond fixtures add` / import** shipped. UX-test: новый API с
   нуля выходит из 0/N path-FK до ≥80% без ручной правки .env.yaml.
4. **Stripe nested form-encoding** исправлен. cross_call_references
   на Stripe даёт ≥3 findings (закрытие m-20 done-criteria #1 наконец).
5. **probe security --oob-server** (ARV-177) shipped.
6. **x-zond-* extensions** (ARV-189) + **dynamic functions** (ARV-190)
   shipped с docs.
7. Skills (`zond-checks.md`, `zond-max-coverage.md`, `zond-base.md`)
   обновлены под новые команды; fb-loop регрессия чистая.

## Гипотеза о размере

После m-20 — 245 findings baseline на Stripe (m-18 + m-20 cross-call 2).
После m-21:
- Stripe nested-form fix → ожидаем +20..40 cross_call findings.
- Linear/GitHub probes → +30..50 findings новых API.
- Mock-testbed → 0 prod findings, но **regression-floor** для всех
  будущих probe-классов.

Этот milestone отвечает на вопрос «как сделать так, чтобы probe-quality
не зависела от того, какой API мы взяли первым». Ответ: controlled
testbed + расширенный зоопарк + fixture-UX, поднимающий empirical
floor для всех probes.
