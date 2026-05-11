---
id: m-18
title: "schemathesis-comparison-and-tooling"
---

## Description

Эмпирический раунд валидации после m-15 (depth-checks) + m-17 (контракты).
Цель — **проверить, где zond уперся, а где можно срезать дёшево, прогнав
zond и 4 внешних инструмента на одном target'е (Sentry API) и сравнив
findings**. Результат — либо подтверждение паритета с schemathesis по
core-функциям, либо точечный gap-fix.

В отличие от m-15 (плановый skoupe фич) и m-16 (открытый bucket мелких
багов) — m-18 это **бенчмарк**: сравниваем zond + schemathesis + quicktype +
sentry-sdk + interactsh + mitmproxy2swagger; для каждого инструмента
формулируем «что он добавляет к нашему пулу findings» и «можно ли это
дёшево всосать в zond».

Принципиально — никаких архитектурных рефакторов в этом milestone.
Вся архитектурная санитария была в m-17. Если comparison-раунд вскроет
новый класс архитектурного долга — он уйдёт в m-19+ отдельным milestone.

## Источники

### Стратегия
- `strategy/strategy.md` §4 — описание m-18, измерения depth/breadth/trust.
- `strategy/lessons.md` — выводы fb-loop'а: «real-world API ≫ synthetic spec»,
  «fb-loop — main QA».
- `strategy/archive/vector-2-schemathesis-parity.md` — изначальная карта
  parity-gap'ов, релевантная часть теперь в strategy.md §3.

### Эмпирика
- Tester-вывод из round-05 (fb-loop): «zond уперся на pass ≈48%, hit ≈71%
  на Sentry; ~150 endpoint'ов skipped в `response_schema_conformance`
  потому что spec не объявляет body schemas; 4 LOW SSRF на symbol-sources
  без подтверждения; 12 endpoint'ов недоступны через REST (replay_id,
  transaction-id)».
- Опросник «какие инструменты добавили бы покрытия» — quicktype/sentry-sdk/
  interactsh/mitmproxy2swagger по убыванию ROI (см. notes ниже).

### Внешние инструменты
- [quicktype](https://github.com/glideapps/quicktype) или
  [genson](https://github.com/wolverdude/GenSON) — генерация JSON Schema
  из реальных response body. В нашем случае — из `zond.db results.response_body`.
- [sentry-sdk Python](https://docs.sentry.io/platforms/python/) — SDK
  ingest для write-only ресурсов (replay_id, transactions).
- [interactsh-client](https://github.com/projectdiscovery/interactsh) —
  OOB DNS/HTTP oracle для SSRF подтверждения.
- [mitmproxy2swagger](https://github.com/alufers/mitmproxy2swagger) —
  HAR → OpenAPI delta для расширения каталога endpoint'ов.
- [schemathesis V4](https://schemathesis.readthedocs.io/) — параллельный
  прогон `--stateful=links --checks all` для diff'а finding'ов.

## Цели майлстоуна

### A. Depth-оживление через quicktype (high ROI)

Главная гипотеза m-18 — `response_schema_conformance` сейчас skipped на
207/209 endpoint'ах Sentry, потому что spec не объявляет `responses.<code>.content.schema`.
У zond в `zond.db` уже лежат 296 реальных 2xx body. Генерация schema из них
и patch'ing spec.json должны «оживить» check на ~150 endpoint'ах.

1. **Pipeline `zond schema-from-runs --run <id>`** — экспорт 2xx body из
   `results`, прогон через quicktype/genson, выдача `patch.schema.json` с
   ключами по endpoint+status.
2. **`zond refresh-api --merge-schema <patch.schema.json>`** — мерж patch
   в spec.json под `responses.<code>.content['application/json'].schema`.
   Сохранение в `.api-resources.local.yaml` через extension-mechanism
   (ARV-111), чтобы не терялось на upstream refresh.
3. **Benchmark на Sentry** — до/после количество schema-drift findings.
   Ожидание: 5-10× рост (с 14 эндпоинтов до ~80-150).

Решение по итогу: либо стандартный путь zond, либо отдельный recipe в skill'е.

### B. Breadth через ingest-SDK и mitmproxy (medium ROI)

Расширение пула endpoint'ов и закрытие write-only пробелов.

4. **`zond ingest sentry-sdk` recipe** — Python-скрипт ~30 строк, создающий
   real event/transaction/replay через Sentry SDK. Получает event_id, issue_id,
   replay_id, transaction_id. Записывает в `.env.yaml` (allowed per memory
   `feedback_env_yaml_editable`). Если ROI подтверждён — обобщается до
   `zond fixture ingest --recipe <name>` с pluggable recipes per API.
5. **mitmproxy2swagger pipeline** — записать 30 минут реальной работы в
   Sentry UI, выгрузить HAR через `mitmweb`, прогнать через mitmproxy2swagger,
   диф против upstream spec → новый набор endpoints. Скормить в zond как
   patch к spec через `.api-resources.local.yaml`.

   Эффект (гипотеза): +20-50 internal-only endpoints к 209, расширяет пул
   для всех probe-классов.

### C. SSRF verdict через OOB-oracle (high ROI, low cost)

6. **`zond probe security --oob-server <url>`** — флаг, который инжектит
   OOB callback URL'ы в SSRF payloads. После каждого probe-раунда zond
   polls OOB log; HTTP/DNS-callback от target API → confirmed HIGH (а не
   `verify manually`).
7. **interactsh integration recipe** — документация как поднять
   interactsh-client локально и связать с `--oob-server`. Если recipe
   стабилен — оформить декларативно в `.api-resources.yaml` (как auth-config).

   Эффект: 4 LOW SSRF на Sentry'е получают явный вердикт (confirmed HIGH
   или confirmed FP). AB9 закрывается за час.

### D. Параллель schemathesis — измерить gap

8. **`zond compare schemathesis --api sentry`** — recipe, который запускает
   schemathesis V4 (`--stateful=links --checks all`) на том же spec'е и
   token'е, диффит findings, выдаёт три bucket'а: `zond-only`, `schemathesis-only`,
   `both`. Это не permanent feature, а одноразовый бенчмарк-script в
   `tests/integration/parity/`.
9. **Закрыть top-N schemathesis-only findings** — если их меньше 10 и они
   укладываются в существующие 12 checks, фиксим как новый sub-mode внутри
   соответствующего check'а. Если их больше — это сигнал, что vector-2 этап 2
   (fuzz engine) нужен раньше, и переносим скоуп в m-19.

### E. Документация и skill-обновление

10. **Recipes-документ** — `docs/recipes/{quicktype,ingest-sdk,interactsh,mitmproxy}.md`.
    Каждый recipe ≤200 строк, copy-paste-ready, на конкретный API (Sentry).
11. **Skill update** — `zond-base`/`zond` получают reference на recipes
    в Phase 2.5 (для ingest) и Phase 4 (для quicktype/SSRF/mitmproxy).
    Apply memory `feedback_update_skills_per_feature`.

## Не покрывает

- **`zond fuzz` engine + auto-shrinker** — это vector-2 этап 2, m-19+. m-18
  только измеряет gap с schemathesis; не имплементит fuzz.
- **BOLA / RBAC matrix** — vector-2 этап 3, m-19+.
- **`zond verify --since main`** — vector-3, depend on knowledge-base, m-19+.
- **Knowledge base + 3 тира** — vector-4, m-19+.
- **Skill auto-generation из CLI manifest'а** — отдельный m-19.
- **GitHub Action + partnership-канал** — vector-5, distribution, не код.

## Принципы

- **Эмпирика > спекуляция.** Сначала прогон + сравнение, потом решение
  «всосать или нет». Каждый блок (A/B/C/D) даёт количественную метрику
  до/после.
- **Recipes, не feature creep.** quicktype/ingest-sdk/interactsh — это
  **рецепты** (документация + ≤30 строк glue-code), не новые подкоманды
  zond. Если рецепт стабилизируется и приносит value 3+ раза — оформляется
  как первоклассная команда. До тех пор — `docs/recipes/`.
- **Один публичный API в качестве benchmark'а** — Sentry. Не размазываем
  m-18 на 5 API; иначе сравнение не воспроизводится. Resend остаётся как
  secondary smoke в fb-loop'е.
- **Анти-FP first.** Любая «оживлённая» schema-violation проверяется на
  регрессию через fixture-pack из m-15.
- **Никаких архитектурных рефакторов.** Если comparison-раунд вскроет
  новый класс долга — пишется отдельный milestone, не лезет в m-18.

## Done-критерий

1. **`response_schema_conformance` на Sentry** даёт ≥80 findings (vs 14
   сейчас) после quicktype-patch. Anti-FP regression-pack m-15 остаётся
   green.
2. **`zond fixture ingest sentry-sdk`** (или recipe) закрывает ≥3 write-only
   var (event_id/issue_id/replay_id) автоматически.
3. **`zond probe security --oob-server`** даёт явный вердикт для всех 4
   LOW SSRF на Sentry'е (либо confirmed HIGH, либо confirmed FP).
4. **mitmproxy2swagger-pipeline** добавляет ≥20 endpoint'ов к каталогу
   Sentry; они hit'ятся `zond run` после `prepare-fixtures`.
5. **`zond compare schemathesis --api sentry`** даёт diff-table трёх
   bucket'ов. Если `schemathesis-only` ≤10 finding'ов — закрыты в zond.
   Если >10 — milestone m-19 («fuzz engine») получает priority high.
6. **Recipes-документация** в `docs/recipes/` для всех четырёх инструментов;
   каждый запускается «вслепую» новым tester'ом за <15 минут.
7. **Skill update** — zond-base/zond ссылаются на recipes; SD-pass через
   `/zond-fb-tester` против Sentry не находит drift'а на новых инструментах.

## Что закрывается из накопленного контекста

- F18 (round 04, ARV-111): extension через `.api-resources.local.yaml` —
  получает реальный use-case через mitmproxy2swagger и quicktype.
- AB9 (4 LOW SSRF Sentry): получает явный вердикт через interactsh.
- Manifest write-only gap (F1-14 long tail, SD11): закрывается рецептом
  ingest-SDK.
- Parity-question «догнали ли мы schemathesis по core» получает
  количественный ответ.

## Гипотеза о размере

При успешном раунде m-18:
- Pass-coverage на Sentry: 48% → ~60-65%.
- Hit-coverage: 71% → ~85-90%.
- Depth-finding'и: ×2-3 (response_schema_conformance активный).
- Security-finding'и: +2-4 confirmed HIGH (через OOB-oracle).

Если эти числа не достигнуты — формулируется в lessons.md и переоценивается
приоритет m-19 (fuzz engine vs knowledge base).
