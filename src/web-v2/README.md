# zond v2 — UI spike (TASK-95)

Параллельный stack для будущего trust-loop UI (decision-5). Живёт рядом с
`src/web/` и не пересекается с ним. Production migration tracked отдельно.

## Stages

- ✅ **Этап 1 — Bun-only baseline.** React 19 + Hono + Bun bundler,
  single-binary через `bun build --compile`.
- ✅ **Этап 3 — Tailwind 4 + shadcn.** Tailwind через `bun-plugin-tailwind`,
  shadcn Button/Table/Badge copy-paste. Единый build через JS API
  (`Bun.build()` + plugin). Vite-fallback не понадобился.
- ✅ **Этап 4 — TanStack Router + Query, два экрана.**
  - 4a: code-based router, RouterProvider + QueryClientProvider, Suspense.
  - 4b: `/api/runs` поверх `listRuns`, loader + `ensureQueryData` +
    `useSuspenseQuery`, фильтр в URL через `validateSearch`.
  - 4c: `/api/runs/:id` + Run detail, failures list, evidence panel
    (Request/Response/Assertions tabs), copy-curl.
  - 4d: `/api/runs/:id/stream` SSE-stub + LiveProgressStrip.
- (Этап 2 — Vite-fallback) — пропущен; Bun-only вытянул все сценарии.

## Запуск

```bash
# dev (Bun.serve HTML-imports + bun-plugin-tailwind через bunfig.toml)
bun run dev:v2
# → http://localhost:6421

# production build (HTML + JS + CSS в dist/web-v2/, единый Bun.build() с плагином)
bun run build:v2
# → dist/web-v2/{index.html,index.js,index.css}

# single-binary (статика встраивается через with { type: "file" })
bun run compile:v2
./zond-v2
# → http://localhost:6421  (ZOND_V2_PORT=… для другого порта)
```

## Замеры (Bun 1.3.13, Apple Silicon)

### Этап 1 — React 19 only, без Tailwind

| Метрика                               | Значение         | Бюджет      |
|---------------------------------------|------------------|-------------|
| JS bundle uncompressed                | 393 KB           | —           |
| JS bundle gzipped                     | 117 KB           | 350 KB gzip |
| Compile time                          | ~220 ms          | —           |
| Single-binary size                    | 61 MB            | —           |
| Cold start (binary → API ready)       | 20–40 ms         | <500 ms     |

### Этап 3 — + Tailwind 4 + shadcn Button + lucide-react

| Метрика                               | Значение         | Δ vs этап 1     |
|---------------------------------------|------------------|------------------|
| JS bundle uncompressed                | 425 KB           | +32 KB           |
| JS bundle gzipped                     | **126 KB**       | +9 KB            |
| CSS bundle uncompressed               | 39 KB            | (новый)          |
| CSS bundle gzipped                    | **5.5 KB**       | (новый)          |

### Этап 4 — TanStack Router + Query, два экрана, SSE

| Метрика                               | Значение         | Δ vs этап 3     |
|---------------------------------------|------------------|------------------|
| JS bundle uncompressed                | 567 KB           | +142 KB          |
| JS bundle gzipped                     | **175 KB**       | +49 KB           |
| CSS bundle uncompressed               | 44 KB            | +5 KB            |
| CSS bundle gzipped                    | **6.8 KB**       | +1.3 KB          |
| Build time (Bun.build JS API)         | ~50 ms           | —                |
| Single-binary size                    | 62 MB            | без изменений    |
| Cold start                            | 20–40 ms         | без изменений    |

Совокупный gzip: **182 KB** при бюджете 350 KB. Запас на shiki
(если понадобится rich JSON viewer), CodeMirror replay-editor (4–5 МБ raw,
~600 KB gzip — отдельная задача), virtualized table.

## DX-журнал (Bun-only)

- 2026-04-30 — этап 1: minimal React app + API endpoint. `Bun.serve` с
  `routes: { "/api/*": fn, "/": indexHtml }` — API и HTML-import
  сосуществуют без хаков. Dev-server поднялся с одной командой
  `bun --hot src/web-v2/server/server.ts`, JSX/TSX бандлится автоматически.
- 2026-04-30 — HMR probe (counter): редактируем текст в `App.tsx` →
  bundle перебилживается, страница обновляется, **state counter-а
  сохраняется**. На таком примере Bun-only ведёт себя как Fast Refresh.
- 2026-04-30 — этап 3, Tailwind 4 + shadcn Button:
  - **Грабли**: `bun build` CLI не применяет плагины из bunfig.toml
    (документированное ограничение). `<link href="tailwindcss">` magic
    path в HTML тоже сломан в 1.3.13 — открытый bug
    [oven-sh/bun#22832](https://github.com/oven-sh/bun/issues/22832).
  - **Решение**: единый build через JS API `Bun.build()` +
    `bun-plugin-tailwind` (см. `scripts/build-web-v2.ts`). Для dev —
    `bunfig.toml` с `[serve.static] plugins = ["bun-plugin-tailwind"]`,
    HTML ссылается на `./src/styles.css` (relative path) — Bun.serve
    подхватывает плагин.
  - **Что сработало искаропки**: shadcn Button copy-paste, Tailwind 4
    `@theme` tokens, `cn()` через clsx + tailwind-merge, lucide-react
    иконки. Никаких Vite-плагинов не потребовалось.
  - **Bundle**: +9 KB gzip JS, +5.5 KB gzip CSS — Tailwind 4 JIT
    выдаёт минимум.
- TODO: считать падения HMR-сервера за 30 мин активной разработки.
- TODO: повторить state-probe на shadcn-форме / TanStack Query-хуке.

## Архитектура

```
src/web-v2/
├── client/
│   ├── index.html              # <link href="./src/styles.css"> + <script src="./src/main.tsx">
│   └── src/
│       ├── main.tsx            # React root mount
│       ├── App.tsx             # счётчик + fetch + shadcn Button
│       ├── styles.css          # @import "tailwindcss" + @theme tokens
│       ├── lib/utils.ts        # cn()
│       └── components/ui/
│           └── button.tsx      # shadcn Button (copy-paste)
└── server/
    ├── server.ts               # dev: Bun.serve + Hono для /api/*
    └── compile-entry.ts        # prod entry для bun build --compile
```

Build pipeline:
1. `scripts/build-web-v2.ts` вызывает `Bun.build()` с
   `bun-plugin-tailwind`, на выходе `dist/web-v2/{index.html, index.js, index.css}`.
2. `compile-entry.ts` импортирует все три как `with { type: "file" }`,
   `bun build --compile` инлайнит в binary.
3. SPA fallback: всё, что не `/api/*` и не `/index.{js,css}`, отдаёт
   `index.html` — для будущего client-side routing.

## API

- `GET /api/hello` — health probe (вернёт `{message, bunVersion, ts}`).
- `GET /api/runs?status=&limit=&offset=` — список runs (поверх
  `listRuns` + `countRuns`). UI-status `passed`/`failed` маппится в
  DB-фильтр `all_passed`/`has_failures`.
- `GET /api/runs/:id` — `{ run, results }` (поверх `getRunById` +
  `getResultsByRunId`).
- `GET /api/runs/:id/stream` — SSE-стрим прогресса. На spike — fake
  ramp-up для любого run (чтобы wiring был проверяем без живого runner-а).
  Production-вариант гейтит на `run.finished_at === null`.

## Известные ограничения и обходы

| Проблема | Источник | Обход в этом spike |
|---|---|---|
| `bun build` CLI игнорирует плагины из bunfig.toml | docs | Использовать `Bun.build()` JS API напрямую |
| `<link href="tailwindcss">` magic path не резолвится через Bun.serve | [#22832](https://github.com/oven-sh/bun/issues/22832) | Использовать relative `./src/styles.css` |
| `bun build --compile` не применяет плагины | docs | Two-stage build: `Bun.build()` → файлы → `--compile` инлайнит как assets |
