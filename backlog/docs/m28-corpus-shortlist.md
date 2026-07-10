# m-28 corpus: shortlist целевых публичных API

Задача ARV-403. Двигатель вехи m-28 (corpus-driven-launch): серия публичных
аудитов, каждый даёт case study + feedback-задачи. Здесь — отобранные цели с
обоснованием и результатом верификации (спек / sandbox / ключ проверены по
живым источникам 2026-07-10).

## Критерии (из m-28)

1. Публичный машиночитаемый OpenAPI-спек (не doc-сайт).
2. Sandbox / free-tier для live-mode без риска — только свои ресурсы
   (no-delete-foreign).
3. Узнаваемое имя — кейс должен продавать.
4. Разнообразие форм: auth-модель, pagination, вложенность CRUD.
5. Преимущественно новые цели (Sentry/Resend уже исследованы).

Бонус-критерий для launch-топлива: вероятность **свежего** (ещё не публичного)
дрейфа спека от реального поведения — это и есть находки для кейса.

## Shortlist (5 целей, порядок = порядок прогонов)

| # | API | Спек | Sandbox / free | Ключ | Отличительная форма |
|---|-----|------|----------------|------|---------------------|
| 1 | **Mailgun** | OAS 3.1, 1 бандл, 169 paths | вечный free + sandbox-домен by design | мгновенно, без карты | **HTTP Basic** `api:key`; домен как path-param; 3 стиля пагинации; v3/v4/v5 в одном бандле |
| 2 | **GitHub REST** | OAS 3.0.3/3.1, 789 paths (12.6 MB) | free live на своих repo/issues | PAT мгновенно | **Link-header** pagination; глубокая вложенность; `securitySchemes` пуст в бандле |
| 3 | **Stripe** | OAS 3.0.0, 437 paths (эталон) | Sandboxes, `sk_test_*` сразу | мгновенно, без карты | **form-urlencoded** тела; cursor; expandable fields; basic ИЛИ bearer |
| 4 | **Vercel** | OAS 3.0.3, 244 paths (автоген) | Hobby free, свои projects/deploys | token мгновенно | «грязный» автоген-спек (известны validation-огрехи → свежие находки); cursor-by-timestamp; экстремальная вложенность |
| 5 | **GoCardless** | OAS 3.0.0, 107 paths, canonical REST | явный sandbox, отдельный signup | token мгновенно, без KYC | bearer + `GoCardless-Version` header; cursor `after`/`before`; lifecycle через `/actions/*`; **gap**: query-params list-эндпоинтов скудно описаны в public-спеке |

**Покрытие форм набором:**
- auth: Basic / PAT-bearer / form-bearer / token-bearer / bearer+version-header
- pagination: opaque-page-url + skip/limit / **Link-header** / cursor `starting_after` / cursor-by-timestamp / cursor `after`/`before`
- тела: JSON / **form-urlencoded** (Stripe — редкая форма)
- спек-качество: curated-бандл / огромный-официальный / эталон / автоген-«грязный» / official-с-gap'ом
- домены: email · devtools · payments · devtools/FE · fintech/direct-debit

**Порядок прогонов:** Mailgun первым (нулевое трение → калибровка формата кейса,
ARV-404), дальше по убыванию узнаваемости / трения.

## Верификация по целям (AC #2)

Все проверены: спек скачан и распарсен, sandbox/free подтверждён, ключ без
KYC/карты (кроме отмеченного).

- **Mailgun** — спек `documentation.mailgun.com/_bundle/.../mailgun.json` (200,
  169 paths). Free plan $0 постоянный (100 писем/день), авто sandbox-домен
  `sandboxXXXX.mailgun.org` (только authorized recipients). Ключ мгновенно, без
  карты. Наименьшее трение из всех.
- **GitHub** — спек `github/rest-api-description` (200, 789 paths). Sandbox нет,
  но live на своих throwaway-repo бесплатен, no-delete-foreign тривиален. PAT
  из настроек, ноль трения. Ремарка: `securitySchemes` пуст в бандле — сам по
  себе finding для контракт-сканера.
- **Stripe** — спек `stripe/openapi` (200, 437 paths, эталон). Sandboxes,
  `sk_test_*` сразу, без карты/верификации. Спек первоклассный → дрейф
  маловероятен; ценность = имя №1 + form-encoded quirk, кейс продаёт форма.
- **Vercel** — спек `openapi.vercel.sh` (200, 244 paths, автоген). Hobby free,
  свои projects/deployments создаются/удаляются даром. Token мгновенно.
  Community сообщал о schema validation-issues → вероятны **свежие** находки.
- **GoCardless** — спек `developer.gocardless.com/openapi-schema-public.json`
  (200, 107 paths). Явный sandbox `api-sandbox.gocardless.com`, отдельный
  signup, изолированная организация, без KYC. Token мгновенно.

## Альтернаты (в резерв, если основная цель не заходит)

| API | Почему в резерве, не в основе |
|-----|-------------------------------|
| **SendGrid** | Дрейф **публично задокументирован** (open issues в twilio/sendgrid-oai) — но именно поэтому находки не «свежие»; free-plan убит в 2025, только 60-дневный триал. Взять точечно ради кейса «spec says required, server disagrees». |
| **Square** | Отличный sandbox + официальный спек (328 ops), но домен payments дублирует Stripe. Форма-плюс: `Square-Version` header + bulk/search RPC. |
| **Plaid** | Громкое имя, мгновенный free sandbox, но **RPC/POST-only** (326 из 331 методов POST) — почти нет path-CRUD и GET-обходов, узкая для сканера форма. |
| **DigitalOcean** | Хорошее имя у small-teams (совпадает с позиционированием), curated-спек, гранулярные scopes — но **карта при signup** (единственный с трением); $200 кредита на 60 дней. |

## Исключено

- **Notion** — официального машиночитаемого спека НЕТ (только readme.io doc-сайт;
  то, что на APIs.guru — конверсия Postman-коллекции, 8 paths). Не годится под
  аудит контракта. Возможен только спец-кейс «community-спек против живого API».

## Ссылки

Stripe `github.com/stripe/openapi` · GitHub `github.com/github/rest-api-description` ·
Vercel `openapi.vercel.sh` · Mailgun `documentation.mailgun.com/docs/mailgun/api-reference` ·
GoCardless `developer.gocardless.com/api-reference/openapi` ·
SendGrid `github.com/twilio/sendgrid-oai` · Square `github.com/square/connect-api-specification` ·
Plaid `github.com/plaid/plaid-openapi` · DigitalOcean `github.com/digitalocean/openapi`
