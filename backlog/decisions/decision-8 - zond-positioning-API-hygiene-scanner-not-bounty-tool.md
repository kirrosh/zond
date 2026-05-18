---
id: decision-8
title: zond positioning — API hygiene scanner for small teams, not bug bounty tool
status: accepted
created_date: 2026-05-16
---

# Context

В течение vector-1..vector-3 positioning zond был размытым: «schemathesis
killer», «API security tester», «AI-output verifier» (vector-5 soft pivot,
2026-04..05). Последний soft pivot не состоялся: после R18 (GitHub-тест,
2026-05-15) и m-21 (severity matrix overhaul + report categorization)
framing уточнился окончательно.

R18 показал главный сигнал — не findings, а **дизайн-проблему**: zond
инфлирует HIGH/CRITICAL severity на пробах без evidence-chain (CRLF без
reflection, SSRF без OOB-канала, mass-assignment без follow-up GET,
132 HIGH spec-lint на статике YAML). Это делает отчёт непригодным для
аудитории, на которую zond реально метит.

Реальная аудитория — **маленькие команды (5-20 разработчиков) без
выделенного security-инженера**, использующие zond как baseline до
релиза. У них:
- нет ресурса разбирать шум HIGH/CRITICAL без proof;
- нет настроенной Burp-инфраструктуры (OOB-сервер, IDOR-matrix);
- есть простой запрос: «прогон за 60 секунд перед релизом, скажи
  что не так».

Конкурировать с Burp/Caido/Akto за bug bounty аудиторию — out of scope:
у них зрелые tools, community plugins, годы фокуса.

# Decision

zond — **API hygiene scanner для маленьких команд**, использующих его
как baseline до релиза.

- **НЕ** bug bounty tool.
- **НЕ** конкурент Burp/Caido/Akto.
- **НЕ** «schemathesis killer» (vector-1 archived).
- **НЕ** «AI-output verifier as primary framing» (vector-5 archived;
  AI-PR-flow остаётся каналом дистрибуции, не аудиторией).

# Принципы (зацементированы m-21)

1. **No evidence — no high severity.** CRITICAL ТОЛЬКО при end-to-end
   exploit-цепочке. HIGH ТОЛЬКО при evidence-chain ≥2 запросов.
   Без proof — потолок LOW.
2. **Категории важнее счётчиков.** Отчёт разделён на 4 категории:
   security / reliability / contract / hygiene.
3. **Тишина — валидный outcome пробы.** Корректное поведение фреймворка
   (Rails strong params, FastAPI extra=ignore) — не INFO, не LOW.
4. **Mock first, prod second.** Каждое изменение severity / категории
   валидируется на controlled testbed (ARV-193).

# Out of scope (формально закреплено)

- Bounty-mode preset / proven-exploit фичи.
- OOB-канал / interactsh-интеграция (ARV-177 deferred-post-pivot).
- BOLA / RBAC matrix с двумя аккаунтами.
- Race conditions / concurrency probes (как security-фича).
- Любые «explore exploit chain» возможности.

Performance/concurrency как **reliability** signal (не security) —
остаётся в vector-6 research, не отброшено.

# Consequences

- **Strategy:** strategy.md §1 переписан под новый framing.
- **Backlog:** ARV-177 deferred-post-pivot; ARV-194 (API zoo) закрыт
  как «расширять зоопарк до пивота бесполезно».
- **Skills:** zond-checks.md, zond-base.md, zond-max-coverage.md
  обновлены под severity matrix + 4 категории (m-21 done-criteria #10).
- **Reports:** HTML/NDJSON/SARIF reporters обновлены под категории.
- **README/landing:** не блокер этого decision'а, но при следующем
  переписывании README — отражать «hygiene scanner for small teams»,
  не «schemathesis killer» и не «AI-output verifier».

# Relation to other decisions

- decision-2 (no MCP), decision-3 (no WebUI), decision-4 (no Postman) —
  совместимы.
- decision-5 (AI-tests + trust-loop) — совместимо, но **trust-loop
  обслуживает hygiene framing, не наоборот**.
- decision-7 (artifacts model) — совместимо.

# Source

- R18 round: `~/Projects/zond-test/.fb-loop/rounds/feedback-18-*.md`
- m-21 milestone: `backlog/milestones/m-21 - deep-testing-and-tuning.md`
- Memory: `project_zond_positioning_pivot.md` (2026-05-15)
- Validation sprint: `strategy/strategy.md` (2026-05-16 rewrite)
