---
id: m-18
title: "schemathesis-comparison-and-tooling"
---

## Description

Эмпирический раунд **измерения**, а не догона. Цель — прогнать zond и
schemathesis V4 на одних API (Sentry / Stripe / Resend, уже настроены в
`~/Projects/zond-test/apis/`) и получить количественный ответ на вопрос
«стоит ли догонять schemathesis по fuzz-engine или наша архитектура
state-aware (m-20) обгоняет это естественным образом».

В отличие от первоначального драфта m-18, после R09 (Stripe) известно
что pass-coverage — breadth-метрика, и приоритет сдвинулся со «всосать
schemathesis-only findings» на «понять класс этих findings и куда они
дальше идут (m-19 fuzz / m-20 state-aware / выкинуть)».

Параллельно — два дешёвых high-ROI блока, которые подтверждаются всеми
тремя API независимо от диффа: **quicktype-патч** (оживляет
`response_schema_conformance` на API без объявленных response schemas)
и **interactsh OOB-oracle** (подтверждает SSRF findings).

Принципиально — никаких архитектурных рефакторов и никакого fuzz-engine
в m-18. Если comparison-раунд покажет, что schemathesis-only findings —
это fuzz-классы, открывается m-19. Если state-aware — это уже в m-20.

## Источники

### Стратегия / контекст
- `backlog/milestones/m-15 - depth-checks-coverage-sarif.md` — что
  закрыто на этапе depth round 1 (12 checks, anti-FP, SARIF).
- `backlog/milestones/m-20 - state-aware-contract-checks.md` —
  параллельный milestone, который двигается за m-18; D-блок (diff) даёт
  данные для priority m-19 vs m-20.
- `backlog/notes/feedback-r09-impressions.md` — продуктовая оценка после
  Stripe-цикла, обоснование сдвига приоритетов.

### Эмпирика
- R09 (Stripe, 9 раундов): pass=58% / hit=70% / 245 findings (92H/153M).
- Tester-вывод round-05 на Sentry: pass ≈48% / hit ≈71%, ~150 endpoint'ов
  skipped в `response_schema_conformance` из-за отсутствия body schemas
  в spec, 4 LOW SSRF на symbol-sources без подтверждения.
- `~/Projects/zond-test/apis/{sentry,stripe,resend}/` — три готовых
  target'а, разные классы spec drift:
  - Sentry: spec без response schemas → quicktype-блок
  - Stripe: spec богатый, но write-only ресурсы → ingest-recipe
  - Resend: small, контрольная группа

### Внешние инструменты (только реально нужные)
- [schemathesis V4](https://schemathesis.readthedocs.io/) — `--stateful=links --checks all`
  для diff'а findings. Главный инструмент m-18.
- [quicktype](https://github.com/glideapps/quicktype) или
  [genson](https://github.com/wolverdude/GenSON) — schema из реальных
  response body (у нас в `zond.db results.response_body`).
- [interactsh-client](https://github.com/projectdiscovery/interactsh) —
  OOB DNS/HTTP oracle для подтверждения SSRF.

mitmproxy2swagger и sentry-sdk-ingest из исходного драфта **выкинуты**
из m-18 — high-cost, низкий ROI на трёх target'ах (см. §«Что не
покрывает»).

## Цели майлстоуна

### D. Параллель schemathesis — главный блок, замер gap

**Это main story m-18.** Всё остальное — поддержка.

1. **`tests/integration/parity/run-schemathesis.sh`** — одноразовый bench-скрипт,
   запускает `schemathesis run --stateful=links --checks all` на тот же
   spec + token, что использует zond. Не permanent feature. Результат —
   JSON-отчёт в `~/Projects/zond-test/.fb-loop/parity/<api>/schemathesis-<round>.json`.
2. **`tests/integration/parity/diff.ts`** — diff zond findings vs
   schemathesis findings. Три bucket'а: `zond-only`, `schemathesis-only`,
   `both`. Schemathesis-only классифицируется на три категории:
   - **(a) fuzz-генерация** — boundary/edge-case violations, которые
     schemathesis нашёл за счёт PBT-генератора → сигнал к m-19.
   - **(b) stateful links** — multi-call invariants → проверка против m-20.
   - **(c) checks которых у нас нет** — единственный bucket кандидатов
     на «всосать в zond» в рамках m-18.
3. **Прогон на трёх API** — Sentry (baseline), Stripe, Resend. Результаты
   в `backlog/notes/m-18-parity-baseline.md`.

### A. quicktype → response_schema_conformance

Параллельный блок, не зависит от D.

4. **`zond schema-from-runs --run <id>` команда** — экспорт 2xx body из
   `results`, прогон через quicktype/genson, выдача `patch.schema.json`
   с ключами по endpoint+status.
5. **`zond refresh-api --merge-schema <patch.schema.json>`** — мерж в
   spec.json под `responses.<code>.content['application/json'].schema`.
   Сохранение в `.api-resources.local.yaml` через extension-mechanism
   (ARV-111).
6. **Дельта-замер** на Sentry до/после quicktype-patch:
   количество `response_schema_conformance` findings. После прогона D
   на Sentry-baseline — повторяем D на Sentry-patched, фиксируем дельту.

### C. SSRF verdict через interactsh OOB-oracle

7. **`zond probe security --oob-server <url>`** — флаг, инжектит OOB
   callback URL'ы в SSRF payloads. После probe-раунда — poll OOB log;
   HTTP/DNS callback от target → confirmed HIGH (вместо `verify manually`).
8. **Recipe `docs/recipes/interactsh.md`** — как поднять interactsh-client
   локально и связать. Если recipe стабилен — кандидат на декларативный
   `.api-resources.yaml` (как auth-config), но в m-18 — только docs.

### E. Документация и решение

9. **`docs/recipes/{quicktype,interactsh}.md`** — copy-paste-ready,
   на конкретный API (Sentry для quicktype, любой для interactsh).
10. **Skill update** — `zond-base`/`zond` ссылаются на recipes
    (Phase 2.5 / Phase 4). Apply memory `feedback_update_skills_per_feature`.
11. **Решение по итогам D-блока** — записать в `backlog/notes/m-18-decision.md`:
    - сколько `schemathesis-only` findings по категориям (a)/(b)/(c)?
    - если (a) > 10 → m-19 (fuzz engine) получает priority high;
    - если (b) > 5 → m-20 уже покрывает их или нужны новые задачи;
    - если (c) > 0 → завести точечные ARV-задачи (внутри 12 checks).

## Не покрывает

- **`zond fuzz` engine + auto-shrinker** — vector-2 этап 2, m-19+.
  m-18 только измеряет gap, не имплементит fuzz.
- **BOLA / RBAC matrix** — vector-2 этап 3, m-19+.
- **mitmproxy2swagger pipeline** — выкинут из m-18: high-cost (30 минут
  реальной UI-работы + auth flow), низкий ROI на Stripe/Resend
  (нет UI traffic'а). Может вернуться в m-19+ как research-pool.
- **`zond ingest sentry-sdk` recipe** — частично решено через
  `feedback_env_yaml_editable` + ARV-113. Если quicktype-блок A не
  закроет write-only пробелы — вернуть как отдельный recipe в m-19.
  В m-18 — out of scope.
- **Knowledge base + 3 тира** — vector-4, m-19+.
- **Skill auto-generation из CLI manifest'а** — отдельный milestone.

## Принципы

- **Замер > спекуляция.** Прогон + diff даёт количественный ответ на
  «догонять или нет». До прогона никаких архитектурных решений.
- **Recipes, не features.** quicktype glue-code оформляется как
  `zond schema-from-runs` (это первоклассная команда, потому что
  benchmark показывает 5–10× рост findings на Sentry — высокая
  переиспользуемость); interactsh — recipe, потому что нужна внешняя
  инфраструктура.
- **Три target'а, разные классы drift.** Sentry — baseline + quicktype
  proving ground; Stripe — богатый spec, проверка что мы ничего не
  ломаем; Resend — контрольная группа (small spec).
- **Анти-FP first.** Любая «оживлённая» schema-violation проверяется
  на регрессию через fixture-pack из m-15.
- **Никаких архитектурных рефакторов.** Если comparison-раунд вскроет
  новый класс долга — пишется отдельный milestone, не лезет в m-18.

## Done-критерий — статус

1. ✅ **D — schemathesis diff** прогнан на Sentry/Stripe/Resend.
   `backlog/notes/m-18-parity-baseline.md` + `m-18-decision.md`.
2. ❌ **A — quicktype patch** — отложено (ARV-175/176 → m-21+).
   Обоснование: parity-замер показал что это отдельный продуктовый
   workflow, не parity-issue. См. decision-doc §«Решение по A-блоку».
3. ❌ **C — `zond probe security --oob-server`** — отложено
   (ARV-177 → m-19+).
4. ❌ **E — Recipes** — отложено. Skill update частично — TODO.
5. ✅ **Decision-документ** `backlog/notes/m-18-decision.md`.
6. ⏳ **Skill update** — TODO в финальном коммите.

Главная цель m-18 (измерить gap, решить нужно ли догонять fuzz) **достигнута**.
4 cheap-fix'а в коде (ARV-179/180/181/183/184) дали архитектурный
паритет на 8 из 12 checks с превосходством на param-axis coverage.

## Что закрывается из накопленного контекста

- F18 (round 04, ARV-111): extension через `.api-resources.local.yaml` —
  реальный use-case через quicktype.
- AB9 (4 LOW SSRF Sentry): явный вердикт через interactsh.
- Parity-question «догнали ли мы schemathesis по core» — количественный ответ.

## Гипотеза о размере (после m-18)

- `response_schema_conformance` на Sentry: 14 → ≥70 findings (quicktype effect).
- 4 confirmed-status вердиктов на Sentry SSRF.
- Чёткое решение по m-19 (go / no-go fuzz engine).
- 1–5 точечных ARV-задач из bucket'а (c) schemathesis-only — если нашлись
  checks которых у нас нет.

Если D-блок покажет что schemathesis-only ≈ 0 после исключения
fuzz-классов — это сильный сигнал, что архитектура zond уже на паритете
и можно фокусироваться на state-aware (m-20) без догона.
