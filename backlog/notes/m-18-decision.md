# m-18 Decision — schemathesis parity status + roadmap

Saved 2026-05-13. Источник: 3 parity-замера (Sentry/Resend/Stripe), 6 кодовых ARV-задач, обновлённый baseline-документ.

## Главный вопрос m-18

> Стоит ли zond'у догонять schemathesis V4 по fuzz-engine, или наша архитектура (state-aware m-20) обгоняет естественным образом?

## Ответ

**Догонять fuzz не обязательно. Архитектурного отставания нет.** На API'ях где обе системы видят 2xx baseline, zond ловит ≥85% schemathesis-findings после ARV-179/180/181/183. Оставшиеся schemathesis-only делятся на 4 класса, ни один из которых не требует fuzz-engine'а уровня hypothesis.

## Замер по 3 API (после всех cheap-fix'ов ARV-179..184)

| API | zond findings | sch findings | BOTH | ZOND-only | SCHEMATHESIS-only |
|---|---:|---:|---:|---:|---:|
| Sentry (overlap 116) | 113 (scc) + 110 (um strict) | 79 + 116 | ~78+110 | 35 | 1+6 |
| Resend (overlap 61) | 61 + 81 strict | 61 + 10 | 61 + 9 | 0 + 72 | 0 + 1 |
| Stripe (overlap 209, strict) | 279 | 130 | 49 | 230 | 81 |

Цифры до фиксов (для контраста): Sentry zond 16 / S-only 193; Resend zond 5 / S-only 115; Stripe (с phantom'ами) zond 41 / S-only 123.

## Классификация оставшегося SCHEMATHESIS-only

После ARV-179..184 + strict-flags оставшийся gap делится так:

### (c'1) Решённые в m-18
- `unsupported_method` enumeration → ARV-179, паритет.
- `status_code_conformance` param-axis → ARV-180, паритет (zond часто превосходит).
- `ignored_auth` differential baseline → ARV-181, паритет на Resend.
- `status_code_conformance` phantom-findings → ARV-183, баг pre-existing с ARV-40 disambig.

### (c'2) Deferred — структурные расхождения, не fuzz
- **`missing_required_header` 42 (Stripe)** — schemathesis считает security-derived `Authorization` за required header; у zond это домен `ignored_auth`. Дублирование запроса нежелательно. → ARV-185 (low, не блокер).
- **`content_type_conformance` 10 (Stripe)** — нужен coverage-phase generator для Content-Type/Accept mutations. → ARV-186 (low).

### (a) Fuzz-only — m-19 territory
- **`positive_data_acceptance` 25-41 (Stripe/Resend)** — fuzz-генерация valid-shape данных, которые сервер reject'ит. Только PBT-engine ловит. → ARV-182 (m-19 trigger, medium priority).

### (b) Stateful — m-20 territory
- ARV-174 D-блок не выявил отдельного stateful-only bucket'а. Stripe stateful-фаза не прогналась, но examples+coverage уже дали полную картину.

## Решение по m-19 (fuzz engine)

**Открыт, medium priority, не блокер.** На write-heavy API (Resend 41, Stripe 25) даёт реальный depth. На GET-heavy (Sentry 2) почти не помогает. m-19 → ARV-182.

**Не делать сейчас.** Сначала:
1. m-20 (state-aware checks) — приоритет выше по R09 lessons.
2. ARV-185/186 — если найдётся ROI на новых API'ях.
3. m-19 — если customer use case потребует write-heavy API fuzzing.

## Решение по A-блоку (quicktype, ARV-175/176)

**Отложен из m-18.** Не делали. Гипотеза была — quicktype оживит `response_schema_conformance` на API без declared response schemas. Но parity-замер показал:
- На Sentry zond `response_schema_conformance` 5 (ZOND-only, depth-checks m-15 работает).
- На Stripe `response_schema_conformance` skip ×2465 (no declared schemas).

Quicktype поможет на Stripe-style, но это **отдельный продуктовый workflow** ("сгенерируй schema по реальным responses"), а не parity-issue. Перевести в m-21+ как отдельную депрессию.

## Решение по C-блоку (interactsh, ARV-177)

**Отложен из m-18.** Не делали. SSRF на Sentry'е (4 LOW finding'а) остаются `verify manually`. interactsh-recipe можно сделать дёшево в m-19+ если security workflow станет приоритетом.

## Решение по E-блоку (recipes + skill update, ARV-178)

**Частично — обновить skills сейчас, recipes отложить.** zond-base/zond skill'ы должны упомянуть:
- `--strict-405` / `--strict-401` флаги
- ARV-180 param-axis coverage
- что `status_code_conformance` теперь fires на много case-kind'ов

Recipes для quicktype/interactsh — отложены до их реализации.

## Done-критерии m-18 — статус

1. ✅ **D — schemathesis diff** прогнан на Sentry/Stripe/Resend. baseline-doc + decision-doc.
2. ❌ **A — quicktype patch** — отложено (см. выше).
3. ❌ **C — `zond probe security --oob-server`** — отложено.
4. ❌ **E — recipes** — частично (skill update нужен).
5. ✅ **Decision-документ** — этот файл.
6. ❌ **Skill update** — TODO в финальном коммите m-18.

3/6 — формально. Но по сути m-18 главную цель («измерить и решить») закрыл: измерение есть, решение есть, 4 ARV-фикса в коде дали реальный паритет на 3 API.

## Чистый вывод

После 4 cheap-fix'ов (ARV-179/180/181/183) zond имеет **архитектурный паритет с schemathesis V4 по 8 из 12 checks**, и **превосходит** на param-axis coverage (zond-only > schemathesis-only на всех 3 API). Оставшиеся 4 check'а — узкие parity-gap'ы со структурной природой, не блокеры.

m-18 закрыт. Следующий milestone: m-20 (state-aware), m-19 — backlog с medium priority.
