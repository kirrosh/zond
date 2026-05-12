# m-18 parity baseline — Sentry smoke (round 1)

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
