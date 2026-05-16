---
id: m-15
title: "depth-checks-coverage-sarif"
---

## Description

Depth round 1 — догон schemathesis по объединённой матрице конкурентов на
80%, без захода в дорогие движки (PBT engine, auto-shrinker, stateful
link-inference, BOLA, knowledge base, verify-pr). Эти куски — отдельные
m-16 / m-17 / m-18.

Источники:
- `strategy/vector-2-schemathesis-parity.md` — этап 1 целиком + кусок
  этапа 2 (workers, filtering, coverage phase).
- `strategy/vector-3-agent-first.md` §5–§6 — `recommended_action` enum
  на check-finding'ах, NDJSON streaming.
- `strategy/audit-and-consolidation.md` §2 «90 вглубь» — boundary
  values, headers/content-type conformance.
- Schemathesis V4 master (2026): 12 встроенных checks с дословными
  именами + anti-FP guards + 4 phases.
- 42Crunch SARIF: `partialFingerprints = sha1(ruleId + jsonPointer +
  spec-hash)` для GitHub Code Scanning dedup.
- Жалобы schemathesis-юзеров (issues #2312/#2726/#2978/#3712) —
  регрессионный fixture-pack для anti-FP.

## Цели майлстоуна

### A. `zond checks` команда + 12 conformance/security checks

1. Каркас команды + реестр + JSON envelope + filtering (ARV-A).
2. 7 conformance checks: `not_a_server_error`, `status_code_conformance`,
   `content_type_conformance`, `response_headers_conformance`,
   `response_schema_conformance` (reuse `--validate-schema`),
   `missing_required_header`, `unsupported_method` (ARV-B).
3. 3 security-flavored: `ignored_auth`, `use_after_free`,
   `ensure_resource_availability` (ARV-C).
4. 2 data-rejection с anti-FP guards: `negative_data_rejection`,
   `positive_data_acceptance` (ARV-D).

### B. SARIF + Coverage phase + NDJSON

5. SARIF v2.1.0 reporter с stable fingerprint (ARV-E).
6. Coverage phase — детерминированные boundary values (ARV-F).
7. NDJSON streaming reporter с published JSON Schema (ARV-J).

### C. Concurrency + UX

8. `--workers N` async-pool на Bun (ARV-H).
9. `--mode positive/negative/all` явный переключатель (ARV-G).
10. Rich filtering `--include`/`--exclude` regex (ARV-I).

### D. Agent ergonomics

11. `recommended_action` enum в каждом check-finding'е (ARV-K).
12. Skill `zond-checks` + AGENTS.md / ZOND.md обновления (ARV-L).

## Не покрывает

- Полный fuzz engine (PBT с json-schema-faker), auto-shrinker — m-16.
- BOLA / RBAC / chain-coverage — m-16 (vector-5 спринт B).
- Stateful link-inference (state machine) — m-17.
- `verify-pr`, knowledge base, findings lifecycle — m-18.
- Akto-style YAML-DSL для пользовательских probes — m-16.
- GraphQL — не делаем (schemathesis сами не дотянули).

## Принципы

- **Имена checks 1-в-1 со schemathesis** — узнаваемость, перенос
  бенчмарков.
- **Anti-FP first** — каждый check имеет fixture-test на регрессию
  известных FP. Лучше пропустить finding, чем выкатить шумный probe.
- **Bun-async, не threading** — даём честный concurrency без GIL.
- **Stdout discipline** — при `--json` / `--ndjson` всё человекочитаемое
  идёт в stderr (как уже в m-13).
- **Reuse существующего ядра**: `runner/schema-validator.ts`,
  `runner/send-request.ts`, `core/probe/method-probe.ts`,
  `core/generator/data-factory.ts`. Новый код — только в
  `src/core/checks/` + `src/core/reporter/sarif.ts` +
  `src/core/generator/coverage-phase.ts`.

## Done-критерий

1. `zond checks list` показывает 12 checks с правильными default-expected
   и severity.
2. `zond checks run --check ignored_auth,use_after_free,ensure_resource_availability`
   находит инжектированные баги на mock-стенде.
3. `zond checks run --report sarif` валидируется по SARIF v2.1.0 schema,
   грузится в GitHub Code Scanning, finding'и dedup'ятся между runs.
4. `--workers 8` ускоряет 50-endpoint smoke-run в 3-5×.
5. Coverage phase — стабильный snapshot на synthetic schema.
6. NDJSON pipe-friendly, schema опубликована в `docs/json-schema/`.
7. Регрессионный fixture-pack из 6 schemathesis-FP issues — все green
   в `negative_data_rejection` / `positive_data_acceptance`.
8. Skill `zond-checks` рабочий — vibe-test через `/zond-fb-tester`
   подтверждает использование команды без подсказок.

## Граф зависимостей

```
ARV-A (каркас checks)
 ├─ ARV-B (7 conformance) ─────────┐
 ├─ ARV-C (3 security)             │
 ├─ ARV-D (2 data + anti-FP) ──────┤
 ├─ ARV-G (--mode) ────────────────┤
 ├─ ARV-I (filtering) ─────────────┤
 ├─ ARV-K (recommended_action) ────┤
 │                                  │
 ├─ ARV-F (coverage phase) ─────── ├─→ ARV-E (SARIF) ─→ ARV-L (skill)
 │                                  │
 └─ ARV-J (NDJSON) ────────────────┘

ARV-H (workers) — независим, можно параллельно с любой ветвью
```

Критический путь: A → {B,C,D} → E → L.
