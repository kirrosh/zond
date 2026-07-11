---
id: ARV-436
title: 'zond fuzz: property-based фаззинг поверх fast-check как доп. фаза checks'
status: To Do
assignee: []
created_date: '2026-07-11 09:17'
labels:
  - m-28
  - fuzz
  - schemathesis-parity
dependencies: []
priority: medium
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Зачем
Единственная незакрытая ось паритета со Schemathesis — случайный property-based фаззинг + auto-shrinking (чеки 12/12, coverage-фаза, modes, workers, rate-limit — уже есть). Цель НЕ догнать Schemathesis, а дать агенту инструмент, который из коробки делает полезное дело: 'zond fuzz --api X' → рандом-нагрузка на все эндпоинты → любые 5xx / schema-violations выпадают как evidence, готовое к триажу. Продолжение решения ARV-182 (fuzz отложен, не закрыт; 'reuse coverage-generator как seed phase, fuzz как phase сверху, shrinker обязателен').

## Litmus
Seeded-фаззинг детерминирован: тот же --seed → те же кейсы → то же evidence. zond эмитит сырьё (input, response, минимальный shrink, curl); 'баг ли это / severity / FP' — суждение агента в триаже. Фаза проходит litmus, отложена была стратегически (decision-8: переполненный рынок), не по litmus. ВНИМАНИЕ: это departure от positioning-pivot — делаем осознанно под agent-ergonomics, не как 'догоняем Schemathesis'.

## Дизайн (максимальный reuse, ponytail)
Не новый движок, а НОВАЯ ФАЗА в существующем checks-пайплайне. Фаза генерит рандомные кейсы (fast-check), а судят их те же 12 check-эвалуаторов (not_a_server_error, response_schema_conformance, status_code_conformance…). Runner/concurrency/rate-limit/SARIF/ndjson — переиспользуются как есть.

1. Зависимость: fast-check (TS, MIT, ~0 транзитивных). Даёт генерацию И shrinking из коробки — это тот 'готовый инструмент'. Единственный новый dep, оправдан (rung 4: не хардкодить свой кривой shrinker).
2. Мост schema→arbitrary: schemaToArbitrary(schema): fc.Arbitrary — маппит общий OpenAPI-сабсет (type/format/enum/min/max/items/properties/required) в fast-check arbitraries. Переиспользовать closed-vocab хинты из data-factory (currency→{{account_currency}}, country→US, mcc, format:email/uuid…), чтобы фаз-тела проходили первый слой валидации, а не были 100% garbage → 400. Неизвестное → строковый arbitrary. Основной объём новизны (~150-250 строк).
3. Фаза fuzz в runner: enumerateFuzzCases(schema, seed, n) через fc.sample(arbitrary, {numRuns:n, seed}) → n BuiltCase с meta.phase='fuzz'. Детерминизм по seed. Складывается в существующий --phase (examples|coverage|fuzz|all).
4. Shrinking на падении: fast-check используется как ГЕНЕРАТОР для массового сэмплинга (через zond-runner, сохраняя rate-limit/workers). На КАЖДОЕ падение чека — точечный fc.assert(asyncProperty(arbitrary, async body => { send; return checkPasses })) только для этого эндпоинта → fast-check сам shrink-ает контрпример до минимального тела. Минимальный кейс + curl кладём в evidence finding'а.
5. zond fuzz — тонкий алиас над 'checks run --phase fuzz' с fuzz-дефолтами (--max-examples, --seed). Discoverable 'инструмент из коробки' для агента; ядро — фаза, не дубль-команда.
6. anti-FP: positive_data_acceptance известен FP-rate (schemathesis #2312/#2978). НЕ добавлять suppression в zond (litmus: FP отсекает агент). Вместо этого — evidence достаточен для триажа (какое поле, какой boundary), и rollup-нарратив как в ARV-407.

## Фазы работы
Phase 1 (deliverable): fast-check dep + schemaToArbitrary + fuzz-фаза + shrink-on-fail + 'zond fuzz' алиас + тесты (unit на мост, mocked-integration на фазу, shrink-тест).
Phase 2 (опц., отдельная задача): example-DB replay падающих seed'ов (SQLite уже есть), targeted PBT.

## Оценка
~1-1.5 недели. Основное — мост schema→arbitrary; shrinking почти бесплатно от fast-check; фаза/алиас/reuse — мелочь.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 fast-check добавлен; schemaToArbitrary покрывает общий OpenAPI-сабсет (type/format/enum/min/max/items/object) с fallback
- [ ] #2 Новая фаза fuzz в checks-runner: fc.sample с --seed детерминирован, кейсы судят существующие 12 чеков, meta.phase='fuzz'
- [ ] #3 На падение чека fast-check shrink-ает вход до минимального; минимальный кейс + curl в evidence
- [ ] #4 'zond fuzz' алиас над 'checks run --phase fuzz' с fuzz-дефолтами; ядро — фаза, не отдельный движок
- [ ] #5 Тесты: unit на мост, mocked-integration на фазу, shrink-тест; anti-FP suppression НЕ добавлен (FP → агент)
<!-- AC:END -->
