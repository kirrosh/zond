---
id: m-10-feedback-original
title: "m-10 secrets-and-redaction feedback (round 5, agent perspective)"
---

# m-10 secrets-and-redaction — исходный фидбэк

Отзыв агента, который весь сеанс читал `.env.yaml` Sentry-воркспейса
(2026-05-06). Триггер: пользователь спросил, не стоит ли разделить
runtime-конфиг на «реальные env (base_url, токены)» и «параметры».

## Что сейчас в одном файле смешано

```yaml
base_url: "https://us.sentry.io"            # ① конфиг — публично OK
auth_token: "sntryu_5731f2e2…"              # ② секрет
organization_id_or_slug: pe-koshelev-kirill # ③ identity (не секрет, но раскрывает аккаунт)
dashboard_id: "4801895"                     # ④ test-fixture
alert_rule_id: 1                            # ⑤ placeholder
```

Это четыре класса с разными свойствами:

| Класс | Чувствительность | Меняется при | Должен ли видеть агент? |
|---|---|---|---|
| ① endpoint config (base_url) | низкая | смена окружения (us/eu/staging) | да |
| ② secrets (auth_token, dsn, webhook_secret) | высокая | ротация ключа | нет — только reference |
| ③ identity (org_slug, member_id моего аккаунта) | средняя | смена аккаунта | возможно, но логировать аккуратно |
| ④ discovered fixtures (real ids ресурсов) | низкая | пересоздание тестовой среды | да |
| ⑤ placeholder defaults (alert_rule_id=1) | нет | никогда | да |

## Где сейчас токен утекает по факту

В этом сеансе токен попал:
- В conversation context — каждый Read файла
- В `zond.db` — `results.request_headers` сохраняет полный `Authorization: Bearer …`
- В `/tmp/sanity.json`, `/tmp/smoke.json`, `/tmp/sec.json` — все JSON-репорты содержат headers
- В `triage/sentry-run-12-smoke-sequential.html` — 921 KB HTML с `Bearer sntry…` ×230
- В каждый case-study `.md` через `--report case-study`

«Один файл с миксом» — не только проблема агента-чтеца, это **artifact pollution**: токен размазан по 5+ местам, и при шеринге HTML/digest его можно неаккуратно отдать наружу.

> **Уточнение из ревью кода (zond):** в текущей схеме `results` хранится
> только `response_headers`, не `request_headers`. HTML-export тоже
> рендерит только response. То есть `Authorization` через headers в
> БД/HTML напрямую не утекает. Но утекает через: `request_url` (token
> в query), `request_body`, `response_body` (echo на 401),
> `response_headers` (Set-Cookie), stdout `--verbose`. Диагноз
> «нет redaction» подтверждён, оценка ущерба — «ниже, чем в отзыве,
> но проблема системная и растёт с каждой echo-точкой».

## Что предложить

### 1. Разделить файлы по классам

```
apis/sentry/
├─ .env.yaml          ① endpoint config + ④⑤ fixtures + placeholders
├─ .identity.yaml     ③ org_slug, member_id, project_slug   (gitignored, agent-OK)
└─ .secrets.yaml      ② auth_token, dsn, webhook_secret     (gitignored, agent-redacted)
```

Три файла, потому что ③ — пограничный случай: иногда хочешь видеть
org_slug в логах для триажа, иногда нет (multi-tenant). Phase 7
share-findings должна по дефолту маскировать `.identity.*` и
`.secrets.*` в любом экспорте.

### 2. Reference-only для секретов в `.env.yaml`

```yaml
auth_token: "@secret:auth_token"           # zond resolve'ит в runtime из .secrets.yaml
auth_token: "${SENTRY_AUTH_TOKEN}"         # из shell env
auth_token: "@op://vault/sentry/token"     # 1Password CLI
auth_token: "@keychain:sentry/auth_token"  # OS keychain
```

Поддержать минимум `${ENV_VAR}` и `@secret:<name>` — последний читает
из `.secrets.yaml`. Тогда сам `.env.yaml` можно даже коммитить (без
identity), потому что в нём только references.

### 3. Auto-redaction в любом persisted artifact

**Это более важно, чем разделение файлов.** Любая строка, попавшая в
zond через `.secrets.yaml` или `${ENV_*}`, должна быть заменена на
`<redacted:auth_token>` в:

- `zond.db` (request_headers, request_body, response bodies если token эхо'нулся)
- `--report json/junit/html` экспортах
- `zond db diagnose`, `zond db run --json`
- `zond report case-study / export`
- `zond probe-* --output digest.md`

Сейчас redaction'а нет вообще. После имплементации — флаг
`--no-redact` для тех, кто хочет видеть raw в локальном дебаге.

### 4. Конвенция определения «это секрет»

Без явного маркера тяжело — у Stripe `sk_live_…`, у Sentry `sntry_…`,
у webhook'а просто длинная hex-строка. Простой rule of thumb:

```yaml
# .env.yaml
auth_token:
  $secret: true           # явный маркер — не нужно угадывать
  value: "${SENTRY_AUTH_TOKEN}"
```

Или, проще: всё в `.secrets.yaml` авто-помечается секретом, остальное
— нет. Даёт чёткую ментальную модель «положил сюда — никогда не
появится в артефактах».

### 5. Practical workflow для агента

Сейчас агент в начале сеанса делает Read `.env.yaml`. После split:

```bash
$ zond doctor --api sentry --json
# выдаёт fixture-pack со ссылками "secret:auth_token (set, 64 chars)" вместо raw
# агент видит "set/unset" + длину, но не значение
```

Агент работает с метаданными секретов, а не с самими секретами. Если
секрет реально нужен (редко) — оператор инжектирует через
`--auth-token <inline>` именно для одной команды.

### 6. Что насчёт `.identity.yaml`

Спорно. **За разделение:** при шеринге case-study наружу не хочется
светить `pe-koshelev-kirill` (мой аккаунт) — пусть будет
`<org_slug>` плейсхолдером, и после авто-redaction'а case-study
становится переносимым. **Против:** триаж без identity иногда
невозможен («баг проявился только на org X с features Y»). Решение —
opt-in redaction: `zond report case-study --redact-identity` для
outbound шеринга, по дефолту identity в локальных файлах.

## Что делать с уже накопленным

В этом workspace токен размазан по `zond.db` (run #8–13),
`triage/*.html`, `triage/*.md`. Нужна команда:

```bash
zond redact --since <run-id>           # перепишет request_headers в db
zond redact triage/                    # пройдётся по всем .html/.md/.json
```

Без неё миграция «одного workspace на новую модель» — это
`git rm -rf triage/ && rm zond.db` и перезапуск.

## TL;DR

**Разделение файлов — правильно, но второстепенно. Первичная
проблема — отсутствие auto-redaction в persisted artifacts.** После
redaction'а:
- Можно даже не трогать `.env.yaml` структуру — токен виден агенту в
  файле, но не утекает в `zond.db`/`triage/`/`--report`.
- А разделение на `.secrets.yaml` + reference syntax (`${ENV}`,
  `@op:`, `@keychain:`) — ortgonal'но: убирает токен из disk-файла,
  чтобы агент даже в `.env.yaml` его не читал.

Идеальный target state: агент видит fixtures и references, секреты
живут в OS keychain / shell env / 1Password, а любой артефакт zond
авто-redact'ит. Тогда «дай мне HTML-репорт коллеге» становится
безопасным действием по умолчанию.
