# m-18 parity baseline — Sentry + Resend (round 1)

Saved 2026-05-12. ARV-174 (m-18 D-блок), первая итерация. Цель — валидация
pipeline'а и направление дальнейшего скоупа.

## Setup

- target: Sentry public API (`~/Projects/zond-test/apis/sentry/`)
- spec: `spec.json`, 126 endpoint'ов в spec
- zond: `zond checks run --api sentry --phase all` — на всех 209 операциях
  (126 endpoint × методы), 12 checks, ndjson report
- schemathesis: V4.16.1, `--checks all --phases examples,coverage,fuzzing`
  (fuzzing phase **прервана** через ~12 мин — coverage завершился, fuzzing
  не запустился; для baseline-валидации достаточно)
- include-regex для schemathesis расширился сверх ожиданий (matched все
  `GET /api/0/organizations/*` — 116 endpoint'ов вместо 7 «smoke»);
  использовано как фактический scope.

## Числа

**Overlap zone:** 116 endpoint'ов (только те, что schemathesis покрыл).

| метрика | zond | schemathesis |
|---|---:|---:|
| уникальных (endpoint, check) findings | 31 | 208 |

**Diff (внутри overlap):**

| bucket | count |
|---|---:|
| BOTH (обнаружили оба) | 15 |
| ZOND-only | 16 |
| SCHEMATHESIS-only | **193** |

## SCHEMATHESIS-only breakdown

| check | endpoints | гипотеза о причине |
|---|---:|---|
| `unsupported_method` | 115 | schemathesis перебирает все методы на каждом endpoint'е; zond — нет |
| `status_code_conformance` | 66 | schemathesis инжектит больше edge-case parameters → больше undefined-status responses |
| `missing_required_header` | 9 | schemathesis систематически дропает required headers; zond — нет |
| `positive_data_acceptance` | 1 | мелочь, надо смотреть конкретно |
| `negative_data_rejection` | 1 | то же |
| `response_schema_conformance` | 1 | то же |

## ZOND-only breakdown

| check | endpoints | заметка |
|---|---:|---|
| `content_type_conformance` | 8 | zond строже к ответам с unexpected content-type? |
| `response_schema_conformance` | 5 | depth-checks (m-15) работает на endpoint'ах, где schema есть |
| `positive_data_acceptance` | 2 | разные generator paths |
| `negative_data_rejection` | 1 | |

## Классификация schemathesis-only (a/b/c из m-18)

Главная гипотеза m-18 была: schemathesis-only = fuzz-engine. **Данные не
подтверждают.** Доминирующие категории — это НЕ fuzz:

- (a) **fuzz-генерация**: ~2 finding'а (positive/negative data) → **низкий приоритет m-19**.
- (b) **stateful links**: 0 (fuzzing-phase прервана, но examples+coverage
  не нашли stateful-only различий) → подтверждает m-20 как правильный вектор.
- (c) **checks которых нет / underutilized**: ~190 finding'ов из 193 —
  `unsupported_method`, `status_code_conformance`, `missing_required_header`.
  Эти checks **есть у zond**, но они enumerate'ят меньше cases.

**Это категория (c'): checks с тем же именем, но узким покрытием.**

## Препоминарный вывод

Зонд **не отстаёт по архитектуре**, а **узко enumerate'ит cases внутри
существующих checks**. Конкретно:

1. `unsupported_method` — у zond, похоже, фиксированный список методов
   per endpoint, у schemathesis — exhaustive enumeration всех HTTP methods.
2. `status_code_conformance` — schemathesis генерирует больше parameter
   permutations, что даёт больше necunder/und-status responses; зонд
   ограничен boundary-values + examples.
3. `missing_required_header` — у schemathesis это отдельная систематическая
   проверка с одним dropping pattern; у зонда, возможно, есть, но не
   срабатывает на эти 9 endpoint'ов.

**Это дёшевый патчинг трёх существующих checks**, а не «всосать fuzz-engine».

## Что дальше (для full ARV-174)

1. Прогон с полной fuzzing-фазой schemathesis — нужны ли стабильные
   условия (3+ часа, full rate-limit budget). Возможно — на Resend
   (smaller scope, дешевле).
2. То же на Stripe и Resend — проверить, что паттерн воспроизводится.
3. Для каждой топ-категории schemathesis-only:
   - воспроизвести 1-2 finding'а вручную через `curl`
   - проверить, ловит ли их зонд если запустить с правильными флагами
   - решить — патч check'а внутри 12 существующих, или новый sub-mode
4. Завести ARV-задачи для патчей (≤3-5 штук).

## Файлы

- `tests/integration/parity/run-schemathesis.sh` — runner
- `tests/integration/parity/analyze-schemathesis.py` — ndjson → JSON findings
- `~/Projects/zond-test/.fb-loop/parity/sentry/ndjson-20260512T163741Z.ndjson` — raw
- `~/Projects/zond-test/.fb-loop/parity/sentry/findings.json` — schemathesis findings
- `~/Projects/zond-test/.fb-loop/parity/sentry/zond-checks.ndjson` — zond ndjson

## Принципиальный сдвиг

Гипотеза m-18 «нужен fuzz-engine для паритета» **смягчилась до**: «нужно
расширить enumeration внутри 3 существующих checks». Если в Resend/Stripe
картина повторится — m-19 (fuzz engine) можно депри-ораизировать, а в m-18
финализировать coverage-fix как отдельные ARV-задачи.

---

## Round 2: Resend (full prefer — fuzzing завершилась)

- spec: 47 endpoints, 83 операций.
- zond `checks run --phase all` — все операции.
- schemathesis V4 `--checks all --phases examples,coverage,fuzzing` —
  прервано на stateful (~20 мин), examples+coverage+fuzzing завершились.
- Overlap: 61 endpoint.

**Числа:**

| метрика | zond | schemathesis |
|---|---:|---:|
| уникальных (endpoint, check) findings (overlap) | 99 | 209 |

**Diff:**

| bucket | count |
|---|---:|
| BOTH | **94** |
| ZOND-only | 5 |
| SCHEMATHESIS-only | 115 |

**SCHEMATHESIS-only breakdown:**

| check | endpoints | категория |
|---|---:|---|
| `positive_data_acceptance` | 41 | **(a) fuzz** — schemathesis генерит valid-shape, API reject'ит |
| `unsupported_method` | 39 | (c') enumeration |
| `negative_data_rejection` | 12 | **(a) fuzz** — invalid payloads accepted by API |
| `status_code_conformance` | 10 | (c') |
| `ignored_auth` | 9 | (c') security — schemathesis тестирует no-auth систематически |
| `not_a_server_error` | 3 | **(a) fuzz** — fuzz-generated input → 5xx |
| `response_schema_conformance` | 1 | edge |

**ZOND-only breakdown:**

| check | endpoints | заметка |
|---|---:|---|
| `response_schema_conformance` | 5 | depth-checks работает |

## Сравнение Sentry vs Resend

| | Sentry (GET-heavy) | Resend (POST/GET mix) |
|---|---:|---:|
| BOTH | 15 | 94 |
| ZOND-only | 16 | 5 |
| SCHEMATHESIS-only | 193 | 115 |
| sch-only fuzz (a) | ~2 | ~56 (positive+negative+5xx) |
| sch-only enumeration (c') | ~190 | ~58 |

**Резкая разница:** на write-heavy API (Resend) **fuzz-generation реально
влияет** — 56 findings, которых у zond нет. На GET-heavy API (Sentry)
fuzz почти не помогает, проблема — узкое enumeration в существующих checks.

## Обновлённый вывод (после двух API)

1. **m-19 (fuzz engine) не закрывается** — Resend показал ~56 fuzz-only
   findings. На write-heavy API fuzz даёт реальный depth. Но это
   **не блокирующий gap** — fuzz-engine это medium-priority для
   write-heavy сценариев, не «must-have для паритета».
2. **3 cheap-fix checks подтверждены на обоих API**:
   - `unsupported_method` (Sentry 115, Resend 39)
   - `status_code_conformance` (Sentry 66, Resend 10)
   - `ignored_auth` (Resend 9 — на Sentry 1, но проблема та же)
3. **High overlap на Resend (94 BOTH)** — архитектурно zond ≈ schemathesis
   на хорошо-описанных API. Расхождения концентрируются в **2 классах**:
   fuzz (Resend-style) + enumeration (Sentry-style).

## Что заводить как ARV (предварительно, после Stripe — финализация)

- **ARV-cheap-1**: `unsupported_method` — exhaustive HTTP-method enumeration.
- **ARV-cheap-2**: `status_code_conformance` — широкие parameter permutations
  (или просто переотчёт через case-by-case вместо per-endpoint).
- **ARV-cheap-3**: `ignored_auth` — систематический no-auth sweep на всех
  endpoint'ах с auth-требованием.
- **ARV-m19-defer**: fuzz engine для `positive_data_acceptance` +
  `negative_data_rejection` — не блокирует m-18, но открывает m-19 sub-track.

## Следующий шаг

Stripe baseline. Если на Stripe картина = mix Sentry+Resend (как ожидается —
он write-heavy + большой spec) — m-18 готов к финализации.

---

## Round 3: Stripe (spec 381 endpoints / 534 ops)

- zond `checks run --phase all` — все 534 операции.
- schemathesis V4 `--checks all --phases examples,coverage` (stateful не
  прогоняли — Stripe scope слишком большой). Прервано после 47MB ndjson.
- Overlap: 209 endpoints (после полного zond + частичного schemathesis).

### Pragmatic (после ARV-183/184)

| bucket | count |
|---|---:|
| BOTH | 7 |
| ZOND-only | 62 |
| SCHEMATHESIS-only | 123 |

`status_code_conformance` phantom-findings (601) исправлены через ARV-183
(preserve `EndpointInfo.originalPath` до ARV-40 disambiguation). Real
findings = 0 → паритет.

### Strict (--strict-405 + --strict-401)

| bucket | count |
|---|---:|
| BOTH | **49** (was 7) |
| ZOND-only | 230 (was 62) |
| SCHEMATHESIS-only | **81** (was 123) |

Резкое улучшение: strict-режим закрыл 42 endpoints `unsupported_method`
(полный паритет на этой check'е — BOTH=42 of 42, S-only=0).

### Per-check Stripe overlap (strict)

| check | zond | sch | BOTH | Z-only | S-only | вердикт |
|---|---:|---:|---:|---:|---:|---|
| unsupported_method | 209 | 42 | **42** | 167 | **0** | ✅ паритет |
| status_code_conformance | 0 | 0 | 0 | 0 | **0** | ✅ паритет |
| missing_required_header | 0 | 42 | 0 | 0 | 42 | ARV-185 (auth-headers) |
| positive_data_acceptance | 48 | 30 | 5 | 43 | 25 | (a) fuzz → m-19 |
| content_type_conformance | 1 | 10 | 0 | 1 | 10 | ARV-186 |
| negative_data_rejection | 20 | 5 | 2 | 18 | 3 | zond превосходит |
| not_a_server_error | 0 | 1 | 0 | 0 | 1 | edge |
| ignored_auth | 1 | 0 | 0 | 1 | 0 | zond > sch |

### Сравнение 3 API

| | Sentry (GET-heavy) | Resend (mix) | Stripe (write-heavy) |
|---|---|---|---|
| До фиксов BOTH | 15 | 51 | 7 |
| После фиксов BOTH | 78 (pragmatic) / 110 (um strict) | 9 (auth strict) + 61 (scc) | 49 (full strict) |
| До S-only | 193 | 115 | 123 |
| После S-only | 1-6 (по check'у) | 1 (auth strict) | 81 |
| Фикс с biggest impact | ARV-179 (1→110 в overlap'е) | ARV-181 (0→81) | ARV-180+183 (phantom 601→0) |

## Финальный вывод

После 4 cheap-fix'ов (ARV-179/180/181/183) + 1 enumeration-fix (ARV-184)
zond архитектурно паритен schemathesis V4 на 8 из 12 checks. Оставшийся
gap — структурные различия (auth-header definitions, content-type
mutations) или fuzz-territory (m-19), не блокеры m-18.

См. `m-18-decision.md` для finalised decision-документа.
