---
id: m-13
title: "hygiene-and-json-readiness"
---

## Description

Track A из стратегии (≈10–15 часов, 2–3 недели): чистка CLI-поверхности,
довести JSON-выходы до agent-ready, фундамент перед vector-2 (depth/fuzz).

Источники:
- `strategy/audit-and-consolidation.md` §3, §4, §7 (спринты 0 и 1)
- `strategy/vector-3-agent-first.md` §5 (5 quick wins по JSON)
- `strategy/vector-1.md` (mass-assignment fix — уже закрыт TASK-276)

## Цели майлстоуна

### A. Спринт 0 — гигиена (drop dead/маргинальный код)

1. Удалить незарегистрированный `probe-by-bogus-id.ts`.
2. Удалить `zond serve` (WebUI полузаброшен; agent-first ≠ UI).
3. Удалить `zond update` (self-update делать через brew/npm).
4. Удалить `zond export postman` (decision-4: OpenAPI уже всё описывает).
5. Удалить `zond report case-study` (объединить в `report export --format markdown`).
6. Удалить deprecated probe-* aliases.
7. Удалить или переименовать `run --no-real-parents` → `--use-synthetic-parents`.
8. Глобальный `--api` флаг (вместо 15× per-command).
9. Слить `--rule` / `--filter-rule` в lint-spec.
10. Добавить 5 недостающих iron rules в `skills/zond.md` / `skills/scenarios.md`.

### B. JSON-readiness (vector-3 §5, 5 quick wins)

11. `--json` envelope на оставшиеся ~24 команды (run, generate, probe-*,
    bootstrap, discover, report-bundle, clean, …).
12. Унифицировать `recommended_action` enum в `Issue`, `SecurityFinding`,
    `FixtureMissing`.
13. Сгенерировать `docs/json-schema/*.schema.json` из zod-типов.
14. `error.code` enum вместо плоского `errors[]: string`.
15. Богатый `zond --help` (one-liner + ссылка на skill для каждой команды).

### C. Mass-assignment fix

- ✅ TASK-276 (5xx-baseline ≠ HIGH privilege escalation) — закрыт. Блок
  оставлен в описании для трассировки vector-1 → m-13.

### D. Спринт 1 — консолидация команд

16. `validate` + `lint-spec` → `zond check` (с back-compat алиасами).
17. `discover` + `bootstrap` → `zond prepare-fixtures`.
18. `probe-validation` + `probe-methods` → `zond probe static`.
19. Дефолты `--timeout` / `--rate-limit` в `zond.config.yml`.
20. Skill `zond-triage` («расскажи что упало в последнем run»).

## Не покрывает

- vector-2 (depth: SARIF, checks, fuzz) — после m-13.
- BOLA / RBAC / chain-coverage (спринт 3 audit-doc).
- `verify --since main`, `agent-loop` — vector-3 спринт 5.

## Принципы

- Каждая задача — отдельный коммит `TASK-<N>: <subject>`.
- Удаление публичной команды/флага → deprecation warning на 1 релиз +
  `CHANGELOG.md` breaking-change запись.
- Перед удалением — `grep` по `skills/`, `docs/`, `README*`.
- Back-compat алиасы — на 1 релиз, не дольше.
