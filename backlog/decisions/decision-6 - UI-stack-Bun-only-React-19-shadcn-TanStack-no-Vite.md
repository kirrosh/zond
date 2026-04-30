---
id: decision-6
title: UI stack — Bun-only React 19 + shadcn + TanStack, без Vite
date: '2026-04-30 16:00'
status: accepted
---

## Context

[decision-5](./decision-5%20-%20Product-direction-AI-generated-tests-with-human-verifiable-trust-loop.md)
переопределил `zond serve` из «secondary surface» в полноправный trust
surface. Roadmap для UI (provenance + evidence chain + spec snippets +
classification badges + suites browser + future replay-editor) выходит
за рамки HTMX-стека текущего `src/web/` (~2.6 KLOC, ad-hoc rendering).

[TASK-95 spike](../tasks/task-95%20-%20spike-new-UI-stack-—-React-19-shadcn-Bun-bundler-Vite-fallback-2-screen-PoC.md)
проверил выбранный stack эмпирически: 4 этапа (skeleton → Tailwind/shadcn
→ TanStack Router/Query → SSE), два рабочих экрана (Runs list +
Run detail с evidence + SSE live-progress strip), single-binary
через `bun build --compile` (62 MB), HMR с сохранением state.

## Decision

UI для `zond serve` строится на:

| Слой | Выбор | Версия (apr 2026) |
|------|-------|-------------------|
| UI runtime | **React 19** | stable |
| Styling | **Tailwind 4** через `bun-plugin-tailwind` | 4.x |
| Components | **shadcn/ui copy-paste** | latest |
| Routing | **TanStack Router** (code-based, не file-based) | 1.x |
| Data | **TanStack Query** (`ensureQueryData` + `useSuspenseQuery`) | 5.x |
| Backend | **Hono** (как в `src/web/`) | 4.x |
| Bundler | **Bun** через `Bun.build()` JS API + plugin | 1.3+ |
| Distribution | **`bun build --compile`** single-binary | — |
| Icons | lucide-react | latest |

**Vite не добавляется.** Bun-only вытянул все DX-сценарии в spike,
включая HMR с сохранением state и копи-паст shadcn компонентов.
Тригер для пересмотра — DX-боль на shadcn-формах или TanStack-хуках в
будущей миграции (state-loss / HMR крэши); пока такого сигнала нет.

### Подтверждённые цифры из spike

| Метрика | Значение | Бюджет |
|---------|----------|--------|
| JS bundle gzipped | 175 KB | 350 KB |
| CSS bundle gzipped | 6.8 KB | — |
| Single-binary | 62 MB | — |
| Cold start (binary → API ready) | 20–40 ms | <500 ms |
| HMR latency | < 200 ms ощутимо | <500 ms |

### Зафиксированные обходы (на момент Bun 1.3.13)

1. `bun build` CLI **не применяет** plugins из `bunfig.toml`
   (документированное ограничение). → используется `Bun.build()`
   JS API в `scripts/build-web-v2.ts`.

2. `<link rel="stylesheet" href="tailwindcss" />` magic path —
   [open bug oven-sh/bun#22832](https://github.com/oven-sh/bun/issues/22832).
   → relative `<link href="./src/styles.css" />`, плагин подхватывает.

3. SSE на больших runs упирается в Bun.serve default `idleTimeout: 10`. →
   `idleTimeout: 255` + try/catch в enqueue + `ReadableStream.cancel()`
   handler.

4. EventSource.onerror срабатывает на нормальный close после `done`. →
   `closedCleanly` ref-флаг гасит ложные error.

## Consequences

### Migration scope (фаза 1)

[TASK-103](../tasks/task-103%20-%20src-web-→-src-ui-production-migration-foundation.md)
— foundation: `src/web-v2/` → `src/ui/`, `zond serve` запускает new UI,
старый `src/web/` удаляется.

### MVP экраны (фаза 1)

Три экрана, фокус на trust-loop сценариях из decision-5:

1. **`/runs`** — список (есть в spike)
2. **`/runs/:id`** — Run detail с evidence panel (есть в spike,
   расширяется в TASK-104, TASK-105)
3. **`/suites`** — Suites browser (TASK-106, новый экран)

### Data prerequisites (параллельно)

Без provenance/classification/spec-pointer UI = «таблица failures»,
ничем не лучше CLI-репорта. Поэтому в backlog заведены:

- [TASK-100](../tasks/task-100%20-%20test-provenance-—-source-metadata-в-YAML-и-DB.md) — provenance в YAML и DB
- [TASK-101](../tasks/task-101%20-%20failure-classification-—-definitely_bug-likely_bug-quirk.md) — failure classification
- [TASK-102](../tasks/task-102%20-%20failure-evidence-—-JSON-pointer-в-OpenAPI-рядом-с-каждым-failure.md) — JSON pointer в OpenAPI

### Cut from spike scope

- **Vite-fallback** — пропущен (Bun-only прошёл).
- **Replay editor / edit-and-resend** — отдельный spike после MVP
  миграции (требует CodeMirror 6, +600 KB gzip).
- **Coverage map page** — фаза 2 после первого fields-feedback от
  пользователей; не критично для trust-loop core.
- **Run trigger UI / Explorer / Dashboard graphs / Multi-collection
  switcher** — отрезаны как противоречащие decision-5 (Postman-like
  manual surface) или vanity (графики pass-rate за месяц).

### Architecture

- `src/ui/client/` — React app (TanStack Router code-based), bundled
  через `Bun.build()` JS API в `dist/ui/`.
- `src/ui/server/` — Hono API + Bun.serve dev server, отдельный
  compile-entry для `bun build --compile`.
- Build pipeline единый: один `bun run build` собирает UI и binary.
- Tests — `tests/ui/` (после удаления `tests/web/`).

## Open questions

- Когда (и при каких метриках) делать spike replay-editor — после
  получения первого внешнего пользователя или раньше.
- Coverage map в фазе 2 vs совмещение с suites browser — TBD после
  фидбека по фазе 1.
- Бундлинг shiki для richer JSON viewer — нужен ли, или существующего
  pretty-print через `JSON.stringify(JSON.parse(...), null, 2)`
  достаточно. Пока не нужен.
