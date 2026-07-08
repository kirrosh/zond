---
id: m-25
title: "polish-cleanup-distribution"
---

## Цель

Закрыть хвост m-24 (добить недорезанную эвристику), **упаковать zond для
чужого пользователя** (README v2, npm/brew, cold-start `init`) и снять
названный потолок honest-2xx скиллом warm-up цели.

Связка **A → B + C**: A — close-out чистки (low-risk, минус LOC), B —
distribution (без него труд m-24 не доходит до пользователя), C —
параллельный скилл-трек вне ядра.

decision-8 (positioning = hygiene scanner для маленьких команд) и litmus test
(детерминировано → в zond; суждение → агенту) остаются в силе. Новый
функционал в непроданный продукт (schemathesis-паритет, новые check-классы)
в m-25 **не** тащим — сознательно отложено, чтобы не отрастить срезанное.

## Bucket A — cleanup close-out (добить m-24)

- **ARV-362** — `discover.ts` (1422L): досвести к детерминированному
  verify + gap-report, срезать остаточное угадывание полей
  (`preferredFieldFromVar`/`pickFieldFromObject`, `?? "id"` fallback).
- **ARV-363** — residual-judgment sweep: сузить `data-factory.ts` до
  placeholder-синтеза под `generate`, доаудитить `path-discovery.ts`
  после ARV-334, решить судьбу `core/severity/` (opt-in инструмент или cut,
  default уже pass-through).

## Bucket B — distribution v2

- **ARV-364** — README v2 + skills переписаны под агент-оркестратора
  (форма m-24: агент собирает suite dumb-инструментами).
- **ARV-365** — package & publish: npm bin + brew tap + cold-start
  `zond init` UX для чужого репозитория (без «ты — это я»-допущений).

## Bucket C — warm-up target (снять потолок honest-2xx)

- **ARV-366** — скилл `warm-up-target`: агент готовит рабочее окружение
  цели (seed issue_id/file_id/integration_id через SDK/UI цели), чтобы
  honest-2xx рос с ~30% к 80%. Вне ядра zond, ложится на litmus test.

## Definition of done

- A: недорезанная эвристика в discover/data-factory/path-discovery закрыта;
  severity/ — судьба решена; минус LOC зафиксирован.
- B: `npm i -g` / `brew install` работают на чистой машине; `zond init` в
  чужом репо доводит до первого прогона без ручной правки внутренностей.
- C: скилл прогнан на ≥1 публичном API, honest-2xx поднят измеримо.

## Контекст

Открыт 2026-07-08 после close-out m-24 (v0.25.0). Бэклог был пуст — чистый
старт. Задачи фазы помечаются ярлыком `m-25`.
