# Agent-recall eval — zond skill descriptions (ARV-397)

2026-07-10. Харнесс: `run.ts` — симуляция скилл-роутера Claude Code через
headless `claude -p`: модели даётся список доступных скиллов (5 zond-скиллов
из variant-каталога + 5 дистракторов: playwright-e2e, unit-tests, http-client,
code-review, docs-writer) и задачная фраза; фиксируется выбранный скилл.
Набор — `phrases.json`: 12 позитивных интентов (RU/EN) + 4 негативных контроля.

## Метрики

| Вариант | recall (zond-семейство на позитивных) | exact-skill | false-activation (негативные) |
|---|---|---|---|
| pre-ARV-393 (без tagline) | **100%** | 67% | 0% |
| current (tagline, ARV-393) | **100%** | **83%** | **0%** |

## Выводы

1. **Baseline recall = 100%** — на всех 12 задачных формулировках («протестируй
   мой API», «contract drift», «почему падает POST», «какие ручки сломаны»)
   роутер выбирает zond-семейство даже при наличии конкурентов-дистракторов.
   Потолок достигнут, итерации ради recall не нужны.
2. **False-activation = 0%** — unit-тесты, browser-e2e, вёрстка и PR-ревью
   корректно уходят в дистракторы/none. zond не оверматчится.
3. **Tagline из ARV-393 не ухудшил триггер, а улучшил внутрисемейную
   маршрутизацию**: exact-skill 67% → 83% (+16 пп). Без tagline первичные
   интенты рассыпались по суб-скиллам (contract drift → zond-checks,
   debug POST → zond-triage, «какие ручки сломаны» → zond-checks); с tagline
   primary-скилл стал корректным аттрактором. Оставшиеся exact-промахи —
   внутрисемейные (security → zond вместо zond-checks) и безвредны: primary
   хэндоффит по своему description.

## Ограничения

- Прокси-метрика: симуляция роутера, не полная сессия Claude Code
  (нет workspace-touch сигналов, контекста репо).
- 1 прогон на фразу (стохастика не усреднена), N=12/4 — трактовать как
  smoke-recall, не как точную величину.
- Модель роутера = дефолт сессии `claude -p`.

## Повторный прогон

```bash
bun run eval/skill-recall/run.ts src/cli/commands/init/templates/skills eval/skill-recall/results-baseline.json
```

Гонять после каждого существенного изменения descriptions (см.
feedback_update_skills_per_feature) и при появлении новых конкурентов-скиллов
в экосистеме.
