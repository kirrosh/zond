---
id: decision-9
title: Phase transition — lighten zond, remove the autonomous heuristic layer, agent owns judgment
status: accepted
created_date: 2026-07-06
---

# Context

m-23 (consolidation phase) отвёл 8–12 недель на валидацию **существующего**
функционала до week-12 evidence-gate (~2026-08-10), с явным запретом на
positioning/architecture-пивоты до этого гейта. Гейт сдвинут вперёд:
data point получен раньше срока и он однозначен.

## Evidence (прогон 2026-07-03, GitHub + Stripe)

Два полных zond-audit прогона по публичным API (GitHub safe / Stripe
live-test) через workflow `zond-audit`. Баланс находок:

- **Находки по самим API** — немного и «знакомой формы»: 1 живой 5xx на
  каждом API + несколько schema-drift/validation. Ядро (request →
  validate-schema → store) отработало чисто, без крашей.
- **Баги zond** — поток, и весь он в **эвристическом слое**:
  - `discovery` положил числовой repo-id `455602789` в login-слот `owner`
    → вырожденный 404-baseline → реальный охват GitHub упал до 5%
    (ARV-334, archived).
  - `prepare-fixtures --seed` — 1% успеха на Stripe, 65 fixtures blocked,
    71% ответов 403 (ARV-327/329, archived).
  - `not_a_server_error` не диспатчится на negative-mutation GET →
    единственный живой Stripe-500 стал невидим (ARV-333, archived).
  - `checks run` без ops/time-budget убит по SIGTERM, post-processing
    потерян (ARV-292/323).

Починка одной строки фикстуры (`owner/repo` → реальный репо) подняла
2xx-ответы 280→603 (2.15×). То есть 5% — артефакт эвристики, а не потолок.

# Diagnosis

Баг-стрим генерирует не тестирование API, а попытка zond быть **умным
автономно**. Эвристический слой (`annotate auto`, `prepare-fixtures
--seed --cascade`, авто-`discovery`, severity-калибраторы) — это замена
агентского суждения хардкод-эвристикой. У каждой эвристики бесконечный
хвост edge-case'ов → «одни и те же API вечно дают новые баги».

Этот слой был **лесами под агента, которому раньше нельзя было доверять**.
Сейчас агент в петле решает лучше эвристики (что такое `owner`, чем сидить
фикстуру, реальный ли баг, какой severity). Леса превратились в balast.
Это возврат к принципу, который уже зафиксирован: zond = dumb-tool,
dump данные → агент думает → apply yaml.

# Decision

1. Снять hold decision-8/m-23 на architecture-пивот — evidence получен.
   decision-8 (positioning = hygiene scanner для маленьких команд)
   **остаётся в силе как позиционирование**; меняется только внутренняя
   архитектура.
2. Открыть m-24: пересобрать zond вокруг агента. Убрать автономный
   эвристический слой, вернуть суждение агенту, оставить детерминированное
   ядро (request / validate-schema / store / diff).
3. Все 25 открытых задач m-23 закрыты (archived, у части — ярлык
   `superseded-m23`): их фиксы либо мутят (heuristic-layer баги, чей fix =
   удаление слоя), либо перекатываются в m-24 явными задачами.

# Consequences

- Меньше кода, меньше поверхность для собственных багов zond.
- Фикстуры/seed/аннотации становятся зоной агента+пользователя
  (дозапрос недостающего), не авто-эвристики.
- Схема-валидация и checks/probes-движок остаются — чистая механика.
- Distribution-задачи (README v2, npm/brew) пересматриваются под новую
  внутреннюю форму, а не тащатся как есть.
