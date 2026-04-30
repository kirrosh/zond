# zond v2 — UI spike (TASK-95)

Параллельный stack для будущего trust-loop UI (decision-5). Живёт рядом с
`src/web/` и не пересекается с ним. Production migration tracked отдельно.

## Stages

- **Этап 1 — Bun-only baseline (текущий).** React 19 + Hono + Bun bundler,
  без Vite, без Tailwind, без TanStack. Цель: проверить, что
  `bun build --compile` встраивает React-приложение в single-binary и
  всё работает end-to-end.
- Этап 2 — добавить Vite (если Bun-only DX не вытянет) и/или сразу для
  Fast Refresh. Перепроверить тот же binary-flow.
- Этап 3 — Tailwind 4 + одна shadcn-кнопка copy-paste.
- Этап 4 — TanStack Router + Query, два экрана (Runs list + Run detail).

## Запуск

```bash
# dev (HMR через Bun.serve HTML-imports)
bun run dev:v2
# → http://localhost:6421

# production build (статика)
bun run build:v2
# → dist/web-v2/{index.html,index.js}

# single-binary
bun run compile:v2
./zond-v2
# → http://localhost:6421  (ZOND_V2_PORT=… для другого порта)
```

## Замеры (этап 1, Bun 1.3.13, Apple Silicon)

| Метрика                               | Значение         | Бюджет      |
|---------------------------------------|------------------|-------------|
| Bundle uncompressed (`dist/index.js`) | 393 KB           | —           |
| Bundle gzipped                        | 117 KB           | 350 KB gzip |
| Bundle modules                        | 10               | —           |
| Production build time                 | ~20 ms           | —           |
| Compile time (`bun build --compile`)  | ~220 ms          | —           |
| Single-binary size                    | 61 MB            | —           |
| Cold start (binary → API ready)       | 20–40 ms         | <500 ms     |

Базовые ~117 KB gzip — это React 19 + ReactDOM. Запас до бюджета большой,
есть куда расти на shadcn/TanStack/shiki.

## DX-журнал (Bun-only)

> Заполняется по ходу разработки. Ключевые сигналы из task-95:
> теряется ли state на edit, падает ли HMR-сервер, искаропки ли shadcn.

- 2026-04-30 — этап 1: minimal React app + API endpoint. `Bun.serve` с
  `routes: { "/api/*": fn, "/": indexHtml }` — API и HTML-import
  сосуществуют без хаков. Dev-server поднялся с одной командой
  `bun --hot src/web-v2/server/server.ts`, JSX/TSX бандлится автоматически.
- 2026-04-30 — HMR probe (1-я итерация, простой counter): редактируем
  текст в `App.tsx` → bundle перебилживается, страница обновляется,
  **state counter-а сохраняется**. На таком примере Bun-only работает как
  Fast Refresh. Развернутый probe (формы, deeply-nested state, hooks
  rules-of-hooks edge) ещё впереди.
- TODO: считать падения HMR-сервера за 30 мин активной разработки.
- TODO: повторить state-probe на shadcn-форме / TanStack Query-хуке.

## Архитектура

```
src/web-v2/
├── client/
│   ├── index.html              # entry HTML
│   └── src/
│       ├── main.tsx            # React root mount
│       └── App.tsx             # этап 1: counter + fetch
└── server/
    ├── server.ts               # dev: Bun.serve + Hono для /api/*
    └── compile-entry.ts        # prod entry для bun build --compile
```

`compile-entry.ts` импортирует артефакты `dist/web-v2/index.html` и
`dist/web-v2/index.js` через `import x from "..." with { type: "file" }` —
Bun инлайнит их в финальный binary. SPA fallback: всё, что не
`/api/*` и не `/index.js`, отдаёт `index.html`.

## API

- `GET /api/hello` — health probe для этапа 1 (вернёт `{message, bunVersion, ts}`).
- (этап 4) `GET /api/runs`, `GET /api/runs/:id`, `GET /api/runs/:id/stream`.
