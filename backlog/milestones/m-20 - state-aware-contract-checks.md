---
id: m-20
title: "state-aware-contract-checks"
---

## Description

После m-18 (recipes + schemathesis-parity) и m-19 (output/reporter-санитария)
zond по-прежнему верифицирует **per-endpoint** контракт: схема ответа,
наличие validation, security-payloads. Это «statics + per-call» depth.

R09-сессия на Stripe (см. `~/Projects/zond-test/.fb-loop/rounds/feedback-09.md`
и final evaluation от тестера) подсветила, что следующий уровень depth — не
больше fuzz'а, а **cross-call state**: если резкий create вернул resource,
последующий GET должен это отражать; повторный POST с тем же
`Idempotency-Key` обязан вернуть тот же response; `?starting_after=X` после
`?limit=N` обязан давать непересекающиеся отсортированные страницы; lifecycle
state-transitions (`pending → active → cancelled`) должны быть валидны.

Эти инварианты — общие для большинства SaaS-API (Stripe/GitHub/Shopify/OpenAI
поддерживают idempotency-keys; Stripe/Slack/Linear — cursor pagination;
любой resource-CRUD API — lifecycle). Это значит zond может проверять их
**без per-API tuning**, если spec/manifest даёт нужные подсказки.

m-20 — это **state-aware contract layer**. Не fuzz engine (это m-21+),
не BOLA-matrix (vector-2 этап 3, тоже m-21+). Cross-call invariants, которые
выводятся из spec'а или объявляются в `.api-resources.yaml`.

## Источники

### Эмпирика
- `~/Projects/zond-test/.fb-loop/rounds/feedback-09.md` — финальный ceiling
  на Stripe; вывод тестера «Coverage measures what zond tested, not what
  zond verified is correct».
- Final session evaluation §4 пункты 1–4 (cross-call invariants, state
  machine, idempotency, pagination).

### Стратегия
- `strategy/strategy.md` §2 «Depth» — куда движемся; m-20 заполняет
  пропуск между «этап 1 закрыт» и «fuzz engine не начинался».
- `strategy/vector-6-real-api-quality-signals.md` (создаётся параллельно) —
  более широкий research-набор; m-20 берёт только bottom 5 пунктов с
  ясным контуром.

## Цели майлстоуна

### A. Cross-call schema invariants

1. **`zond checks --check cross-call-references`** — после `POST /resource → id`,
   автоматически GET-ит `/resource/{id}`. Сравнивает: создатели поля
   (что POST принял) попадают в read-back; missing-field-after-create →
   HIGH; extra-field-after-create → MEDIUM. Использует `.api-resources.yaml`
   для resource-graph'а.

### B. Idempotency-key invariant

2. **`zond probe idempotency`** — для каждого POST с meta-флагом
   `idempotent: true` в `.api-resources.yaml` (или с заголовком
   `Idempotency-Key` в spec extensions): отправить два раза тот же body+key,
   проверить bit-identical response (модулo `created_at`/`updated_at`),
   проверить что *не* создан дубликат через `GET /list`. HIGH если duplicate
   resource, MEDIUM если response not bit-identical.

### C. Pagination/cursor invariants

3. **`zond probe pagination`** — для каждого `GET /list` с
   detected pagination (cursor/page/offset, выводится из spec или
   `.api-resources.yaml`): `?limit=N` → page A, `?after=last_id` → page B.
   Проверить: непересечение A∩B, ordering, total count consistency,
   no-gap (последняя страница содержит `has_more=false` или эквивалент).

### D. State-machine / lifecycle

4. **`.api-resources.yaml` lifecycle declarations** + checker.
   Объявить per-resource state-machine (например, `subscription.status:
   pending → active → cancelled` с допустимыми переходами). После
   `POST .../cancel` GET должен вернуть `status: cancelled`, повторный
   cancel — 4xx или idempotent 200, обратный переход → HIGH.

### E. Webhook delivery verification

5. **`zond probe webhooks`** (опционально, если в spec'е объявлены
   webhook events) — POST action который должен триггерить webhook
   (через webhook URL → mitmproxy/interactsh-style receiver, recipe от m-18),
   проверить: event получен, shape совпадает со spec'ом
   `webhooks.<name>.post.requestBody.schema`, retry policy при 5xx receiver,
   ordering preserved.

## Не покрывает

- **Fuzz engine + auto-shrinker** — m-21+. m-20 использует deterministic
  state-probes, не property-based генерацию.
- **BOLA/RBAC matrix** — m-21+. m-20 — single-tenant invariants.
- **Performance/latency probes** — vector-6 / m-21+. m-20 — correctness only.
- **Race / concurrency probes** — vector-6. m-20 — sequential cross-call.
- **Business-logic invariants** (`refund <= charge`) — domain-specific, не
  выводится из spec'а. Вне scope m-20.

## Принципы

- **Spec/manifest first.** Если invariant не выводится из OpenAPI или
  `.api-resources.yaml` — он не для m-20 (он для domain-scenarios/руками).
- **Anti-FP first.** Каждый новый check — fixture-test на регрессию
  (Stripe + Sentry + Resend как target'ы).
- **Recipes для нестандартного.** Webhook receiver = recipe (как
  interactsh в m-18), не часть core zond.
- **Skill catch-up.** zond-checks / zond-max-coverage обновляются параллельно;
  без skill-mention новый check останется невидимым (lesson m-15..17 §C).

## Done-критерий

1. Cross-call-references check находит ≥3 contract-drift на Stripe
   (например, `customer.metadata` теряется при POST→GET).
2. Idempotency probe на Stripe (test mode с `Idempotency-Key`) даёт
   green для Stripe и фиксирует ≥1 finding на каком-то менее зрелом API
   (Resend/целевой публичный) — иначе probe бесполезен.
3. Pagination probe находит non-trivial issue (off-by-one, duplicate
   item, missing `has_more`) хотя бы на одном из публичных API.
4. Lifecycle declarations поддержаны хотя бы для одного resource в
   `apis/stripe/.api-resources.yaml` (subscription / payment_intent /
   charge), checker зелёный.
5. Webhook recipe в `docs/recipes/webhook-receiver.md`, копируется
   tester'ом за <15 минут на Stripe тестовом аккаунте.
6. Skills (`zond-checks.md`, `zond-max-coverage.md`) ссылаются на новые
   probe'ы; fb-loop регрессия не находит skill-drift.

## Гипотеза о размере

R09 baseline на Stripe: 245 findings (92 HIGH / 153 MEDIUM), все per-endpoint.
После m-20 — ожидаем +30..50 cross-call findings из нового класса (drift
между write и read shape'ами Stripe — известная проблема). Hit-coverage не
меняется (state-checks работают над тем же набором endpoint'ов), но
**quality-signal density** растёт: на одном endpoint'е мы теперь верифицируем
contract + validation + security + cross-call state, а не только первые три.

Этот milestone отвечает на вопрос «как сделать так, чтобы pass-coverage 58%
действительно означал quality, а не breadth». Ответ: добавить класс checks,
который меряет correctness, а не coverage.
