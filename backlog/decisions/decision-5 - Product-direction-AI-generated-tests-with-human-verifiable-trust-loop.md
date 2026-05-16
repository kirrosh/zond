---
id: decision-5
title: Product direction — AI-generated tests with human-verifiable trust loop
date: '2026-04-30 12:00'
status: accepted
---

## Context

Через decisions 2/3/4 surface zond сжат к одному ядру: CLI + agent skills,
с web UI и postman-export как secondary read-mostly surface. Backlog v0.22.0
закрыл 19 round-2 papercut-ов; m-4 насыщен probe-классами (mass-assignment,
schema validation, SSRF, CRLF, state-machine, pagination, auth-scope, fuzz).

Эмпирический сигнал из живых сессий и при формулировании стратегии:

- Конкуренты в нише spec-grounded testing уже есть. Schemathesis закрывает
  stateless property-based fuzz; Postman/Hoppscotch — manual-first
  request-конструкторы; StackHawk — paid DAST. Бить эти продукты «по их
  фичам» (deeper fuzz, лучше UI, больше assertion DSL) — проигрышно.
- Реальный gap, который не закрывает никто: **доверие к
  AI-сгенерированным тестам и к найденным багам**. Когда агент говорит
  «прогнал 50 suites, 47 passed, 3 бага» — у пользователя нет дешёвого
  способа проверить, что тесты осмысленные, что баги настоящие, и потыкать
  конкретный запрос руками.
- У zond уже есть оба surface'а, нужные для trust-loop: CLI/skills для
  агентной генерации и `src/web/` для человеческой инспекции. Decision-3
  относилась к web UI как к «secondary, occasional human inspection» —
  это занижало его роль.

## Decision

zond — это **AI-native API testing tool с human-verifiable trust loop**.
Продукт состоит из двух равных surface'ов, каждый из которых обязателен:

1. **Agent surface** (CLI + skills): агент читает OpenAPI, генерирует
   stateful CRUD/business-flow YAML, прогоняет smoke + probe-классы +
   property-based fuzz, выдаёт structured JSON envelope с
   `recommended_action`/`env_issue`.
2. **Human trust surface** (`zond serve`): пользователь видит провенанс
   каждого теста (почему он такой, какую ветку спеки покрывает), evidence
   chain каждого бага (сырые request/response, ссылка на место в спеке,
   готовый `curl` для repro), coverage map с явными причинами пропусков,
   и interactive request replay (edit-and-resend).

Bug-hunting (semantic probes + fuzz) — **средство, а не цель**. Цель —
чтобы человек, открыв отчёт zond, за минуту сказал «да, эти тесты
осмысленные, эти баги настоящие, я могу показать их бэкендеру».

### Differentiation

- vs **Postman/Hoppscotch**: AI-first, спека — источник правды; YAML в
  git вместо json-collection; не manual request-конструктор.
- vs **Schemathesis**: stateful business-flows, generated maintainable
  YAML-артефакты, semantic probes (mass-assignment, auth-scope,
  idempotency), AI-shaped report. Stateless fuzz — built-in
  (json-schema-faker + fast-check, ~80% покрытие use-case'а),
  schemathesis опционально через adapter.
- vs **StackHawk/Bright**: бесплатно, OSS, AI-агентная генерация
  поверх спеки, не требует security-команды.

### Non-goals

- **Replacement Postman лоб-в-лоб.** 30M users, щедрый free tier — не
  целимся в этот рынок целиком. Цель — отдельный сегмент: команды,
  живущие в Claude Code/Cursor, которым нужен API-testing встроенный в
  AI-workflow.
- **Глубокий property-based fuzz уровня Hypothesis.** Shrinking,
  stateful Hypothesis stratagems — оставляем schemathesis. zond даёт
  достаточный fuzz, чтобы не было причины звать второй tool в 80% случаев.
- **Не-OpenAPI sources** (gRPC, GraphQL, AsyncAPI) — пока вне scope;
  пересматриваем при явном demand.
- **Cloud SaaS как первый продукт.** Сначала OSS CLI + локальный UI;
  managed-CI-runner — следующая ступень после демонстрации demand,
  не до.

## Consequences

### Backlog priorities

- **Provenance + evidence chain становятся приоритетом m-4.** Probe-классы
  без провенанса и evidence — это «AI-spam»; провенанс вытаскивает их
  на уровень дефенсибельного артефакта. Конкретные задачи (новые,
  оформляются отдельно):
  - test-provenance: каждый сгенерированный suite/step несёт `source`
    (endpoint, response-code branch, generator class) в YAML и в репорте.
  - failure-evidence: `db diagnose` отдаёт по каждому failure готовый
    `curl` для repro и ссылку на место в OpenAPI спеке (path + JSON
    pointer).
  - failure-classification: явное разделение
    `definitely_bug` / `likely_bug` / `quirk` поверх существующего
    `recommended_action`.

### Architecture

- **decision-3 пересматривается.** `zond serve` — не «secondary», а
  второй обязательный surface. TASK-MEDIUM.7 (dead-code scan) продолжает
  исключать `src/web/`; новые фичи в области trust loop (provenance в UI,
  request replay, coverage map) — first-class работа, не обслуживание.
- **decision-4 без изменений.** Postman exporter остаётся заморожен в
  read-only режиме; trust loop строится в собственном UI, не в чужом.
- **Schemathesis — опциональный adapter, не зависимость.** Built-in fuzz
  через TASK-93 закрывает 80% use-case'а; `zond fuzz --via schemathesis`
  оставляем как opt-in subprocess-bridge для power-users без runtime-зависимости.

### Validation path

Прежде чем масштабировать (HN/Reddit/инвестиции в SaaS), нужны
эмпирические артефакты доверия:

1. Прогон zond против 2–3 публичных API (Stripe, Resend, что-то open-source)
   с публикацией write-up: что нашли, скриншоты trust-UI, ссылки на репорты.
2. Один внешний пользователь, поставивший zond в свой CI и оставивший
   там работать — проверка, что trust loop удерживает на дистанции, не
   только при первой демонстрации.

Без этих двух пунктов разговор про SaaS/масштабирование преждевременен.

## Open questions

- Когда (и при каких метриках) пересмотреть non-goal про не-OpenAPI sources.
- Какая минимальная форма interactive replay в `zond serve` отвечает на
  «дайте мне понажимать в запрос» — отдельный backlog spike.
- Стоит ли формализовать «evidence-chain как публикуемый артефакт»
  (HTML/PDF-репорт пригодный к шерингу с бэкендером), или достаточно
  ссылки на локальный `zond serve`.
