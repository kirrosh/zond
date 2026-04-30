---
id: TASK-103
title: src/web/ → src/ui/ production migration foundation
status: Done
assignee: []
created_date: '2026-04-30 09:36'
updated_date: '2026-04-30 10:36'
labels:
  - trust-loop
  - decision-5
  - ui
dependencies:
  - TASK-95
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

TASK-95 spike доказал, что Bun-only React 19 + Tailwind 4 + shadcn +
TanStack Router/Query + bun build --compile работают end-to-end
(spike живёт в src/web-v2/). Теперь нужно превратить spike в продовую
замену src/web/.

Этот task — foundation, без новых фич. Только перенос и интеграция.

## Что делаем

1. **Переименование:** `src/web-v2/` → `src/ui/`. Spike-комментарии
   `// TASK-95 spike — production migration tracked separately`
   удаляются.
2. **CLI integration:** `zond serve` по умолчанию запускает new UI.
   Старый `src/web/` deprecated и удаляется ИЛИ оставляется под
   `--legacy-ui` (TBD при имплементации; склоняюсь к полному удалению,
   потому что dead-code drag).
3. **Tests:** новый `tests/ui/` (или `tests/web/` после удаления старого).
   Минимальный coverage: smoke-тест, что `/`, `/runs`, `/runs/:id`
   возвращают 200 и API endpoints отдают валидный JSON.
4. **Build pipeline:** `package.json` build script собирает UI до
   `bun build --compile` основного `zond` binary. Сейчас это два
   отдельных скрипта; нужно объединить.
5. **Old src/web/ removal:** дроп всего HTMX-стека после убеждения, что
   `tests/web/` смерджены / переписаны под new UI.

## Зависит

- TASK-95 закрыт и спайк-ветка smerged
- decision-6 акцептован (фиксирует Bun-only без Vite)

## НЕ входит

- Новые UI-фичи: provenance display (TASK-104), classification badges
  (TASK-105), suites browser (TASK-106). Foundation сначала.
- Replay editor — отдельный spike после MVP миграции.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 src/web-v2/ переименован в src/ui/, spike-комментарии удалены
- [x] #2 zond serve запускает new UI; старый src/web/ удалён
- [x] #3 tests/ui/ smoke-тесты на /, /runs, /runs/:id и API endpoints — зелёные
- [x] #4 Единый build pipeline: bun run build собирает UI + binary за одну команду
- [x] #5 bun test зелёный, bunx tsc --noEmit чистый
<!-- AC:END -->
