---
id: TASK-95
title: 'spike: new UI stack — React 19 + shadcn + Bun bundler (Vite fallback), 2-screen PoC'
status: To Do
assignee: []
created_date: '2026-04-30 14:00'
labels:
  - spike
  - ui
  - trust-loop
  - decision-5
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

[decision-5](../decisions/decision-5%20-%20Product-direction-AI-generated-tests-with-human-verifiable-trust-loop.md)
переопределил `zond serve` из «secondary surface» в **trust surface** — равноправный
с CLI/skills. Ближайший roadmap для UI (provenance + evidence chain + interactive
replay + coverage map) выходит за рамки того, что разумно делать на текущем
Hono+HTMX-стеке (`src/web/`, ~2.6 KLOC): нужны JSON-editor с edit-and-replay,
diff request/response, live-stream прогона, rich табличные сетки.

После брейншторма стека (2026-04-30) выбран базовый вариант:
**React 19 + shadcn/ui + TanStack Router + TanStack Query + Hono backend
+ bun build --compile**.

**Открытый вопрос — нужен ли Vite, если уже есть Bun.** В 2026 Bun bundler
поддерживает HTML-imports, JSX, Tailwind (`bun-plugin-tailwind`), HMR и
console-log forwarding. Но имеет две дыры: нет React Fast Refresh
(state теряется на dev-edit) и HMR-сервер на больших проектах
периодически крэшится. Vite 8 + Rolldown (март 2026) закрыл и скоростной
аргумент в пользу Bun bundler.

Перед миграцией `src/web/` целиком нужен spike — proof-of-concept на 2
экрана, который **попутно отвечает на вопрос «Bun-only или Bun+Vite»
эмпирически**, замеряет bundle/HMR/cold-start и проверяет bun-compile
end-to-end.

## Цель spike

Доказать (или опровергнуть), что выбранный стек:

1. Embed-ится в `bun build --compile` без хаков.
2. Даёт приемлемый bundle size (целевая верхняя граница — **350 KB gzipped**
   для shell + два экрана + все perf-критичные виджеты).
3. Hot-reload в dev-loop работает быстро (HMR <500 ms на типичный edit).
4. AI-агент пишет код за один проход на этом стеке (субъективная оценка
   при реализации).
5. Не ломает текущий `src/web/` (новый сервис живёт параллельно, по другому
   порту, либо под `/v2/*` префиксом).

И отдельный вопрос (B): **достаточен ли Bun bundler как замена Vite**
для нашего кейса (2 экрана, react-формы в evidence-panel, минимальный
edit-flow)? Метрика — DX-боль на типичной работе:
- теряется ли component state на edit (отсутствие React Fast Refresh)
- сколько раз HMR-сервер падает за 30 минут активной разработки
- работают ли shadcn копи-паст компоненты «искаропки» без Vite-плагинов
  (Tailwind 4 + clsx + class-variance-authority + tailwind-merge)
- получается ли собрать production-bundle одним `bun build` без отдельной
  prep-стадии

Если spike по A проходит, но по B Bun-only показывает регулярную боль —
fallback на **Bun + Vite** (см. Acceptance ниже). Spike считается
успешным независимо от исхода. NO-GO по A целиком — переход к варианту
A из брейншторма (Datastar+islands).

## Scope spike

### Что входит

**Новый сервис: `src/web-v2/`** (имя финальное — `src/ui/` после миграции,
но на время spike не пересекаемся со старым `src/web/`).

**Два экрана:**

1. **Runs list** (`/runs`) — таблица всех runs из SQLite с колонками:
   created_at, status (PASS/FAIL/INCONCLUSIVE), suite count, pass/fail/error
   counts, duration. Фильтр по status, сортировка по дате. Click row → переход
   на run detail.

2. **Run detail** (`/runs/:id`) — три зоны:
   - Header: meta-инфо (env, suite, base_url, started/finished).
   - **Failures list** (главный compact-блок): группированные failures с
     `failure_class`, `recommended_action`, `endpoint`. Каждый item раскрывается
     в **evidence panel**: request (method+url+headers+body), response
     (status+headers+body, JSON-viewer с подсветкой), expected vs actual diff,
     кнопка «Copy curl» (готовая команда для repro). Это прообраз evidence
     chain из decision-5.
   - **Live progress strip** (если run в статусе running) — SSE-стрим
     прогресса с backend, обновляет счётчики реактивно.

Этих двух экранов достаточно, чтобы упражнять все нагруженные UI-примитивы:
table, navigation, JSON-viewer, diff, code-snippet copy, SSE live updates,
expandable cards, filters.

### Что НЕ входит

- Replay-editor (edit-and-resend) — отложен, требует отдельного решения по
  CodeMirror 6 интеграции.
- Coverage map / endpoints / suites экраны — после спайка.
- Auth (`zond serve` локальный, single-user — auth не нужен).
- Тесты UI (smoke-проверка вручную; e2e — следующая задача).
- Миграция старого `src/web/` — параллельно с ним.

## Технический stack

### Frontend (`src/web-v2/client/`)

**Стартуем на Bun-only**. Vite добавляется только если по результатам
DX-замеров (см. вопрос B выше) Bun bundler не вытягивает.

| Зависимость | Назначение | Версия (apr 2026) |
|---|---|---|
| `react` + `react-dom` | UI runtime | 19.x stable |
| `react-compiler` (через babel-plugin) | auto-memo | latest |
| `bun-plugin-tailwind` | Tailwind интеграция в Bun bundler | latest |
| `tailwindcss` | styling foundation для shadcn | 4.x |
| `@tanstack/react-router` | type-safe routing, file-based | 1.x |
| `@tanstack/react-query` | data-fetching + cache + SSE-friendly | 5.x |
| `shadcn/ui` (копи-паст) | Button, Table, Card, Badge, Dialog, Tabs, Sheet, Separator, ScrollArea, Tooltip, Skeleton | latest |
| `class-variance-authority` + `clsx` + `tailwind-merge` | shadcn deps | latest |
| `lucide-react` | icons | latest |
| `shiki` | JSON / curl syntax highlight (вместо тяжёлого Monaco) | latest |
| `diff` + custom renderer (или `react-diff-view`) | request vs response diff | latest |

### Fallback зависимости (только если Bun-only не вытягивает)

| Зависимость | Назначение | Версия |
|---|---|---|
| `vite` | dev-server + HMR + Fast Refresh | 8.x с Rolldown |
| `@vitejs/plugin-react` | Fast Refresh для React 19 | latest |
| `@tailwindcss/vite` | Tailwind 4 vite-плагин | latest |

### Backend (`src/web-v2/server/`)

Минимально: Hono routes, отдающие JSON для двух экранов:

- `GET /api/runs` — список runs (читает существующий SQLite через текущий
  `db` модуль из `src/core/`).
- `GET /api/runs/:id` — детали run + failures (через
  существующий `db diagnose` core-логику, обёрнутую в JSON).
- `GET /api/runs/:id/stream` — SSE поток прогресса для running runs
  (заглушка на spike — отдаём фейковый progress если run в статусе running).

**Никакой новой бизнес-логики**: только тонкая обёртка над `src/core/db/*`.

### Build

**Bun-only path (стартуем здесь):**

- Dev: `bun run --hot src/web-v2/server/server.ts` поднимает Hono +
  embedded `Bun.serve` HTML-imports на одном порту (`localhost:6421`).
  Bun сам бандлит JSX/CSS из `<script>`/`<link>` тегов в HTML.
- Prod build: `bun build src/web-v2/client/index.html --outdir=dist/ui --minify`
  собирает статику. Hono импортирует `dist/ui/index.html` через
  `import indexHtml from "./dist/ui/index.html"` →
  `bun build --compile src/web-v2/server/compile-entry.ts -o zond-v2`.
- Verify: `./zond-v2 --port 6421` поднимает single-binary с UI и работает
  без Node.js / без отдельных файлов.

**Vite fallback path (если Bun-only не вытягивает):**

- Dev: `vite dev` для UI (`localhost:5173`), Hono — `bun run --hot ...`
  (`localhost:6421`), proxy через vite.config.
- Prod build: `vite build` → `dist/ui/` → дальше идентично Bun-only пути.

### Структура каталогов

```
src/web-v2/
├── client/                       # frontend (Vite root)
│   ├── index.html
│   ├── src/
│   │   ├── main.tsx
│   │   ├── routes/               # TanStack Router file-based
│   │   │   ├── __root.tsx
│   │   │   ├── runs/
│   │   │   │   ├── index.tsx     # экран 1: список
│   │   │   │   └── $runId.tsx    # экран 2: detail
│   │   ├── components/           # shadcn copy-paste + custom
│   │   │   ├── ui/               # shadcn artefacts
│   │   │   ├── failures-list.tsx
│   │   │   ├── evidence-panel.tsx
│   │   │   ├── live-progress.tsx
│   │   │   └── json-viewer.tsx
│   │   ├── lib/
│   │   │   ├── api.ts            # query fns (TanStack Query)
│   │   │   └── sse.ts            # SSE consumer hook
│   │   └── styles.css            # tailwind entry
│   ├── vite.config.ts
│   ├── tailwind.config.ts
│   └── tsconfig.json
├── server/
│   ├── server.ts                 # Hono app, mounts API + serves UI
│   ├── routes/
│   │   ├── runs.ts
│   │   └── runs-stream.ts
│   └── compile-entry.ts          # entry для bun build --compile
└── README.md                     # как запустить spike
```

## Acceptance Criteria

- [ ] Установлены базовые зависимости (Bun-only stack) — react/react-dom,
      tailwindcss, bun-plugin-tailwind, TanStack Router/Query, shadcn deps,
      shiki, diff. В корневой package.json или отдельный — на усмотрение
      реализации.
- [ ] Реализованы оба экрана (Runs list + Run detail с evidence panel и
      SSE-progress strip) на **Bun bundler без Vite**.
- [ ] `bun run dev` поднимает Hono+Bun.serve на 6421 с HMR и работающим
      UI без отдельного dev-server.
- [ ] `bun run build:ui && bun build --compile src/web-v2/server/compile-entry.ts -o zond-v2`
      собирает single-binary; `./zond-v2` запускает рабочий UI без внешних
      файлов и без Node.js.
- [ ] Замерены и записаны в `src/web-v2/README.md`:
      bundle size (gzipped и uncompressed), bun-compile binary size delta,
      cold start time, HMR latency на типичный edit, время первого билда,
      **DX-журнал по Bun-only**: где терялся state, падал ли HMR-сервер,
      работали ли shadcn-компоненты без модификаций.
- [ ] Если Bun-only вытянул — Vite не добавляется, spike оставляет минимальный стек.
- [ ] Если Bun-only не вытянул (зафиксировано в DX-журнале) — добавляется
      Vite-fallback, переснимаются те же замеры, в README сравнение
      Bun-only vs Bun+Vite.
- [ ] Существующий `src/web/` и его тесты не сломаны (`bun test` зелёный).
- [ ] Проверен один цикл «AI-агент добавляет третий экран» — субъективная
      запись в README: сколько шагов / правок потребовалось vs ожидалось.
- [ ] Решение зафиксировано в decision-6:
      - GO Bun-only → миграция `src/web/` → `src/ui/` распилена на 4-5
        backlog-задач, без Vite в стеке.
      - GO Bun+Vite → то же, но с Vite в стеке + обоснование (что именно
        не вытянул Bun bundler).
      - NO-GO React → переход к варианту A (Datastar+islands),
        пересмотр decision-5 в части UI implementation.

## Definition of Done

- Acceptance criteria выше — все галочки.
- Замеры по bundle size / HMR / cold start приложены в README spike.
- decision-6 создан со статусом `accepted` и одним из двух исходов.
- Если GO — заведены 4-5 backlog-задач для миграции (имена/scope в decision-6).
- Если NO-GO — заведена spike-задача под вариант A (Datastar) с теми же двумя
  экранами для честного сравнения.
- Spike-код помечен `// TASK-95 spike — production migration tracked in TASK-XXX`
  в основных файлах, чтобы было видно при чтении.

## Implementation Plan

1. **Скелет (Bun-only)** — `src/web-v2/` с client/server/, `bun init` или
   ручная разводка, Tailwind 4 + `bun-plugin-tailwind`, shadcn компоненты
   копи-пастом из реестра (CLI shadcn не дружит с bun → ручной copy-paste).
2. **API endpoints** — Hono routes под `/api/runs` и `/api/runs/:id` поверх
   существующего `src/core/db/*`. SSE заглушка на отдельном route.
3. **Routing + layout** — TanStack Router, `__root.tsx` с базовой навигацией,
   shadcn theme provider, dark/light toggle.
4. **Runs list экран** — Table компонент, TanStack Query запрос, фильтр по
   status, сортировка.
5. **Run detail экран** — header + failures list (Card+Collapsible), evidence
   panel (Tabs: request/response/diff), JSON-viewer (shiki), copy-curl
   button, SSE-strip.
6. **Build pipeline (Bun-only)** — `bun build` для UI → import HTML в Hono →
   `bun build --compile`, проверить single-binary запускается на чистой машине.
7. **Замеры Bun-only** — bundle size, binary size, HMR latency, cold start.
   DX-журнал в README: state-loss на edit, падения HMR, проблемы со shadcn.
8. **Решение по Vite**: если DX-журнал чистый — продолжаем, Vite не добавляем.
   Если есть регулярная боль (state теряется в evidence-форме при каждом
   edit; HMR упал >2 раз за сессию) — добавляем Vite, повторяем шаги 6-7
   и сравниваем.
9. **AI-агент тест** — попросить Claude Code добавить третий экран
   (suites list), записать сколько шагов потребовалось.
10. **Decision-6** — GO Bun-only / GO Bun+Vite / NO-GO React, follow-up задачи.

## Risks / Open Questions

- **Bun bundler без React Fast Refresh** — главный известный риск
  Bun-only пути. На 2 экранах spike может не проявиться (мало форм),
  но это маркер для production. Документируем эмпирически в DX-журнале.
- **HMR Bun-сервер падает на больших проектах** — на spike из 2 экранов
  скорее всего не словим, но если случится — это сильный сигнал в пользу
  Vite-fallback.
- **shadcn CLI vs bun.** shadcn-cli из коробки рассчитан на pnpm/npm. На
  Bun-only пути почти точно нужен ручной copy-paste компонентов из
  shadcn-реестра. Не блокер, но шаг в плане.
- **Tailwind 4 + bun-plugin-tailwind зрелость.** Плагин официальный, но
  моложе vite-плагина. Проверяем: JIT, purging, custom @theme.
- **React Compiler stability в проде.** На 2026-04 stable, но bug-fix-волны
  встречаются. Если ловим грабли — отключаем compiler, остаётся обычный
  React 19 без auto-memo. На 2 экранах перф не критичен.
- **bun build --compile + code-splitting.** Поведение при динамическом
  import надо проверить — возможно, придётся отключить chunk-splitting
  и собирать одним bundle. Это окей для embedded UI.
- **JSON-viewer без Monaco.** Решение через shiki (syntax-highlight) выбрано
  ради бандла. Monaco на этом этапе НЕ берём — он гигантский (~3 МБ) и
  нужен только для replay-editor (отдельная задача).

## Связанные документы

- decision-5 — продуктовое направление (trust loop)
- decision-3 — устаревший статус `zond serve`, будет пересмотрен в decision-6
- TASK-MEDIUM.7 — dead-code scan, исключает `src/web/` (после миграции
  исключение переедет на `src/ui/`)
<!-- SECTION:DESCRIPTION:END -->
