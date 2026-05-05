# zond UI

React 19 + Tailwind 4 + shadcn + TanStack Router/Query, поверх Bun-only стека
(Bun.serve, Bun.build с `bun-plugin-tailwind`, single-binary через
`bun build --compile`). Это продовый UI для `zond serve`.

История стека и обоснование Bun-only-выбора — см. TASK-95 в backlog
и [decision-5](../../backlog/decisions) / [decision-6](../../backlog/decisions).

## Запуск

```bash
# dev (Bun.serve HTML-imports + bun-plugin-tailwind через bunfig.toml)
bun run dev:ui
# → http://localhost:6421

# production build (HTML + JS + CSS в dist/ui/, единый Bun.build() с плагином)
bun run build:ui
# → dist/ui/{index.html,index.js,index.css}

# полный single-binary (статика + CLI)
bun run build
./zond serve
# → http://localhost:8080
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

## Архитектура

```
src/ui/
├── client/
│   ├── index.html              # <link href="./src/styles.css"> + <script src="./src/main.tsx">
│   └── src/
│       ├── main.tsx            # React root mount
│       ├── router.tsx          # TanStack Router конфиг
│       ├── styles.css          # @import "tailwindcss" + @theme tokens
│       ├── lib/                # api client, utils, hooks
│       ├── components/ui/      # shadcn (button, badge, table)
│       └── routes/             # runs-list, run-detail
└── server/
    └── server.ts               # createApp() + startServer({dev?})
```

Build pipeline:
1. `scripts/build-ui.ts` вызывает `Bun.build()` с `bun-plugin-tailwind`,
   на выходе `dist/ui/{index.html, index.js, index.css}`.
2. `src/ui/server/server.ts` (prod-ветка) импортирует все три как
   `with { type: "file" }` — `bun build --compile src/cli/index.ts`
   инлайнит их в `./zond` binary.
3. SPA fallback: всё, что не `/api/*` и не `/index.{js,css}`, отдаёт
   `index.html` — для client-side routing TanStack Router.

## API

- `GET /api/hello` — health probe (вернёт `{message, bunVersion, ts}`).
- `GET /api/runs?status=&limit=&offset=` — список runs (поверх
  `listRuns` + `countRuns`). UI-status `passed`/`failed` маппится в
  DB-фильтр `all_passed`/`has_failures`.
- `GET /api/runs/:id` — `{ run, results }` (поверх `getRunById` +
  `getResultsByRunId`).

## Известные ограничения и обходы

| Проблема | Источник | Обход |
|---|---|---|
| `bun build` CLI игнорирует плагины из bunfig.toml | docs | Использовать `Bun.build()` JS API напрямую (`scripts/build-ui.ts`) |
| `<link href="tailwindcss">` magic path не резолвится через Bun.serve | [#22832](https://github.com/oven-sh/bun/issues/22832) | Использовать relative `./src/styles.css` |
| `bun build --compile` не применяет плагины | docs | Two-stage build: `Bun.build()` → файлы → `--compile` инлайнит как assets |
