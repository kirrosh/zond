---
id: m-21
title: "deep-testing-and-tuning"
---

## Description

После m-20 (state-aware contract layer) инфраструктура для cross-call invariant'ов
shipped: 5 probe-classов (`cross_call_references`, `idempotency_replay`,
`pagination_invariants`, `lifecycle_transitions`, webhook recipe) + 6 подкоманд
`zond api annotate` (dump+apply, no LLM inside zond). Skill-каталог обновлён.

Но **эмпирический сигнал тонкий**: на Stripe test API 57/69 кейсов
`cross_call_references` skipped из-за broken-baseline 400. Sentry заблокирован
FK-резолюцией. Итог: probes работают, но валидированы на узкой поверхности.

### Пивот после R18 (GitHub-тест, 2026-05-15)

Прогон m-20 probes против GitHub API дал главный сигнал **не findings, а
дизайн-проблему**: текущий зонд инфлирует HIGH/CRITICAL severity на пробах
**без evidence-chain** (CRLF без reflection, SSRF без OOB, mass-assignment
без follow-up GET, 132 HIGH spec-lint на статике YAML). Это делает отчёт
непригодным для аудитории, на которую зонд реально метит — **небольших
команд (5-20 разработчиков) без security-инженера**, использующих зонд как
API hygiene baseline до релиза.

Конкурировать с Burp/Caido за bug bounty аудиторию (proven exploits через
OOB-каналы, IDOR-matrix с двумя аккаунтами, race conditions) — out of scope:
у них зрелые tools и community plugins, а у зонда нет ресурса повторить
эту инфру.

m-21 пивотирует от **«расширения surface для probes»** к **«пересборке
severity-матрицы и категоризации отчёта»** под реальную аудиторию. API zoo
(ARV-194) закрыт как Done — расширять зоопарк до пивота severity бесполезно.
OOB-сервер (ARV-177) снят с m-21 как Burp-территория.

## Источники

### Эмпирика m-20 close-out (ARV-192, 2026-05-13)
- `backlog/notes/m-20-validation.md` §Closure — almetric таблица + done-criteria
  статус. cross_call 2/3 с задокументированным ceiling.
- Stripe seed: 25/69 path-FK после prepare-fixtures `--seed --apply` + 17
  annotated seed_body. Остальные POST → 400 даже с валидным body (Stripe
  form-encoding nested params, required-fields в test mode, balance/Connect
  зависимости).
- Sentry orphans: 108 endpoints. Stripe orphans: 281. **0 high-confidence
  новых CRUD-resources** — все lifecycle actions на каталогизованных
  ресурсах либо singleton/read-only.

### Стратегия
- `strategy/strategy.md` §2 «Depth» — m-21 закрывает gap между «m-20 shipped»
  и «fuzz/BOLA-matrix начался».
- Без m-21 любой следующий probe-class будет страдать тем же data-quality
  ceiling — это блокер не алгоритмический, а инфраструктурный.

## Цели майлстоуна (после пивота R18)

### A. Severity matrix overhaul (ARV-250)

Пересборка severity-матрицы под принцип **«no evidence — no high
severity»**. CRITICAL ТОЛЬКО при end-to-end exploit-цепочке; HIGH требует
evidence-chain из ≥2 запросов; без proof — потолок LOW. Отсутствие CRITICAL
в отчёте — feature, не баг.

### B. Report categorization (ARV-251)

Отчёт разделён на 4 категории: **security / reliability / contract /
hygiene**. 5xx → reliability, schema drift → contract, spec-lint → hygiene.
Маленькая команда видит per-category roll-up и понимает с чего начинать.

### C. Mass-assignment probe → evidence-chain (ARV-252)

Probe переписан с follow-up GET: поле применилось → MEDIUM/HIGH; silently
dropped → ТИХО (не INFO, не LOW — ничего). Это пилот общего принципа
evidence-chain.

### D. CRLF / storage-injection → evidence-chain (ARV-253)

Reflection-check после storage: HIGH только при reflection в опасном
контексте (header / unescaped HTML). Без reflection — INFO в hygiene,
не в основном отчёте.

### E. SSRF accept severity rebalance (ARV-254)

LOW дефолтом без OOB-канала + явный disclaimer. ARV-177 (OOB-server)
снят с m-21 как Burp-территория.

### F. Spec-lint separation (ARV-255)

Все spec-lint findings принудительно LOW/INFO. Отдельный режим `zond lint`.
Из основного audit-отчёта spec-lint уходит. Цель: 0 HIGH на статике YAML.

### G. Small-team value-add checks (ARV-256)

Три новые проверки с высоким signal-to-noise: rate-limit absent on write
endpoints, open CORS на authenticated endpoint, missing-auth-mismatch
(спека требует auth — endpoint вернул 200 без токена). Это и есть ниша
зонда: low-config baseline для маленьких команд.

### H. Controlled testbed с regression-floor (ARV-193)

Mock-API с заранее известными багами **под новую severity-матрицу**.
Regression-floor для всех изменений A-G. Без этого пивот не верифицируем.

### I. Fixture-bootstrap UX (ARV-195)

`zond fixtures add` + dashboard-import. UX-task, ортогонален пивоту,
остаётся в m-21.

### J. Stripe form-encoding fix (ARV-196)

Nested form params (`card[number]`, `items[0][price]`). Корневая причина
57/69 broken-baseline. Остаётся в m-21.

### K. Spec-driven config polish

**`x-zond-*` OpenAPI extensions** (ARV-189) + **dynamic value functions**
(ARV-190). Низкий cost, ортогональны пивоту.

### Снято с m-21

- **ARV-194 API zoo expansion** → Done (расширять зоопарк до пивота severity
  бесполезно; Linear/Shopify будут добавлены позже как regression-validation
  новой матрицы).
- **ARV-177 OOB-server** → deferred-post-pivot (Burp-территория, out of
  scope без bounty-mode).

## Не покрывает

- **Fuzz engine + auto-shrinker** — m-22+.
- **BOLA/RBAC matrix** — m-22+ (Burp-территория; см. пивот).
- **OOB-канал / interactsh-интеграция** — deferred-post-pivot (ARV-177).
- **Bug bounty mode preset** — не делаем; зонд позиционируется как API
  hygiene scanner для команд, не как bounty-tool.
- **Performance/latency probes** — vector-6.
- **Race / concurrency** — vector-6.

## Принципы

- **No evidence — no high severity.** CRITICAL ТОЛЬКО при end-to-end
  exploit. HIGH ТОЛЬКО при evidence-chain ≥2 запросов. Без proof —
  потолок LOW.
- **Категории важнее счётчиков.** Команда из 5 человек должна видеть
  «0 security, 12 reliability» и понимать с чего начинать, а не «132 HIGH»
  и паниковать.
- **Тишина — валидный outcome пробы.** Если зонд не доказал импакт —
  finding не выпускается. Корректное поведение фреймворка ≠ INFO/LOW.
- **Mock first, prod second.** Каждое изменение severity / категории
  валидируется на controlled testbed (ARV-193) ДО прогона на реальном API.
- **Не строим Burp.** Bounty-grade фичи (OOB, IDOR-matrix, race conditions)
  — out of scope.

## Done-критерий

1. **Severity matrix overhaul** (ARV-250) shipped: regression-test
   фиксирует severity per probe-class под новую матрицу.
2. **Report categorized** (ARV-251) в 4 категории; HTML/NDJSON/SARIF
   reporters обновлены.
3. **Mass-assignment** (ARV-252) и **CRLF** (ARV-253) переписаны с
   evidence-chain; mock-regression подтверждает silent-on-no-effect.
4. **SSRF severity** (ARV-254) пересмотрен; disclaimer в finding.
5. **Spec-lint** (ARV-255) ушёл из основного отчёта в `zond lint`;
   на текущей GitHub-спеке 0 HIGH в основном audit.
6. **3 новые small-team проверки** (ARV-256) shipped: rate-limit absent,
   open CORS, missing-auth-mismatch.
7. **Mock-testbed** (ARV-193) расширен под все изменения 1-6.
8. **Fixture-bootstrap** (ARV-195) + **Stripe form-encoding** (ARV-196)
   shipped.
9. **x-zond-* extensions** (ARV-189) + **dynamic functions** (ARV-190)
   shipped с docs.
10. Skills (`zond-checks.md`, `zond-max-coverage.md`, `zond-base.md`)
    обновлены под новую матрицу + категории; fb-loop регрессия чистая.
11. **Validation rerun**: GitHub-прогон m-20 + новых проверок под
    обновлённой матрицей даёт реалистичный отчёт (ожидаемо 0-2 HIGH,
    остальное — категоризированные reliability/contract/hygiene).

## Гипотеза о размере и сигнале

До пивота: 132 HIGH на GitHub из них ~0 actionable.
После пивота:
- Spec-lint downgrade → -132 HIGH из основного отчёта.
- Mass-assignment без follow-up GET → silent → -N LOW.
- CRLF без reflection → INFO в hygiene → -N HIGH из security.
- 5xx → reliability категория → severity adjustment, не выкид.
- Новые small-team проверки → +0-3 actionable HIGH (open CORS / no-auth-mismatch
  — реально находятся в маленьких сервисах).

Этот milestone отвечает на вопрос **«какая у зонда аудитория и как
сделать отчёт пригодным для неё»**. Ответ: небольшие команды,
честная severity, чёткие категории, evidence-chain как принцип.
