---
id: m-8-notes
title: "m-8 audit-cli-gaps notes"
---

# m-8 audit-cli-gaps — заметки

## Файлы

- [feedback-original.md](feedback-original.md) — исходный фидбэк (2 раунда:
  JSONPlaceholder + Sentry Public API), скопирован из
  `~/Projects/zond-test/feedback-zond.md`. Не трогать (исторический документ).

## Карта фидбэк → задачи

| Раздел фидбэка | Задача |
|---|---|
| Раунд 2 §A. probe-validation `nonexistent-zzzzz` | TASK-135 |
| Раунд 2 §3 (skill). discovery fixtures вручную | TASK-136 |
| Раунд 2 §B. mass-assignment 51 INCONCLUSIVE | TASK-137 |
| Раунд 2 §F + §2 (skill). SSRF/CRLF в скилле текстом | TASK-138 |
| Раунд 2 §C. CRUD-чейны на классической REST-форме | TASK-139 |
| Раунд 2 §D. `zond db run --status` без диапазона | TASK-140 |
| Раунд 2 §E. case-study рендерит full body | TASK-141 |
| Раунд 2 §G. `--validate-against` для одиночного request | TASK-142 |
| Раунд 2 §5 (skill). bundle для диапазона run-id | TASK-143 |
| Раунд 2 §H. `--retry-on-network` для ECONNRESET | TASK-144 |
| Раунд 2 §I. `doctor --json` структура и `--missing-only` | TASK-145 |
| Раунд 2 §1 (skill). `--emit-template` для MA | TASK-146 |
| Раунд 2 §4 (skill). env_issue early-stop | TASK-147 |
| Раунд 2 §6 (skill). `zond db compare` в Phase 4 | TASK-148 |
| Раунд 2 §F (skill-side). baseline-OK для security | TASK-149 |

## Раунд 1 (JSONPlaceholder)

В основном перекрывается уже закрытыми задачами по spec-less API
(`TASK-131` — `zond add api --base-url`, `TASK-132` — `zond request --api`
auto-prefixes). Из открытого:

- §3 «`--json` флаг непоследователен между `request` и `run`» — мелочь
  для `m-7`/UX-polish, не сюда.
- §6 «`--json-path <dotpath>` для извлечения одного поля» — отложить, не
  блокер для аудита.
