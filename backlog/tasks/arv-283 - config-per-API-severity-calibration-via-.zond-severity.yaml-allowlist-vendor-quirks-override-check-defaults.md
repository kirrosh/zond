---
id: ARV-283
title: >-
  config: per-API severity calibration via .zond/severity.yaml (allowlist vendor
  quirks, override check defaults)
status: To Do
assignee: []
created_date: '2026-05-18 09:41'
labels:
  - config
  - severity
  - calibration
  - signal-to-noise
dependencies: []
priority: high
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
## Контекст

Severity сейчас вшита в check-implementation файлы (`src/core/checks/checks/*.ts:severity: 'high'|'medium'|...`). Recommended_action enum закрытый. Подавление false-positive class'ов (Stripe `Stripe-Should-Retry` vs `RateLimit-*`, silent-drop unknown body fields на Stripe POST'ах, write-only fields на subscription_schedules cross_call_references, etc) требует commit'а в zond — это не масштабируется на N вендоров.

Свежий пример (Stripe ARV-282 scan):

- 222 endpoints с MEDIUM `rate_limit_headers_absent` (Stripe юзает `Stripe-Should-Retry`; формально valid alternative но для нас always-flag noise → per-API allowlist бы решил)
- 100 раз `negative_data_rejection` HIGH с `recommended_action: tighten_validation` (additionalProperties silent-drop; Stripe-by-design forward-compat → должно быть INFO/LOW, не HIGH)
- 2 HIGH `cross_call_references` на write-only fields (Stripe ожидает что эти поля accept-only; spec correct, поведение by-design → calibrate down для resource'ов с known write-only set)

Calibration сейчас приходится делать триаж-агенту (см. Stripe report-api.md "Headline" + per-finding 'demote HIGH→MED rollup' разделы). Это лишний шаг для каждого скана + drift между что агент считает MEDIUM и что код пишет.

## Цель

Внести severity-config в workspace, чтобы:
1. Per-API overrides жили в `apis/<name>/.zond-severity.yaml` (read-only quirks конкретного вендора).
2. Workspace-wide defaults и known-vendor-patterns в `.zond/severity.yaml` (Stripe-вообще, GitHub-вообще, etc).
3. Built-in defaults в коде остаются — config только overrides.
4. Findings уже на этапе emission получают финальную severity (не post-hoc filter в reports).

Это разблокирует "industrial CI gate" — команда настраивает severity под свой stack один раз, дальше pipeline зелёный по signal.

## Schema (предложение)

```yaml
# .zond/severity.yaml (workspace) или apis/<name>/.zond-severity.yaml (per-API)
version: 1

# Override severity для всего check'а
checks:
  rate_limit_headers_absent:
    # либо severity: low, либо суждение через condition
    severity: low                          # глобально demote rate-limit MEDIUM → LOW
  negative_data_rejection:
    by_action:
      tighten_validation: medium           # demote HIGH → MEDIUM когда recommended_action указывает spec-tightening, не bug
      report_backend_bug: high             # сохраняем HIGH для exploit-evidence

# Suppress конкретный pattern (full skip — emit'ится как INFO/INFO-suppressed для аудита, не считается в CI)
suppressions:
  - check: rate_limit_headers_absent
    when:
      response.headers["Stripe-Should-Retry"]: present  # vendor uses alternative header
    reason: "Stripe uses Stripe-Should-Retry instead of RateLimit-*"

  - check: negative_data_rejection
    when:
      evidence.mutation.boundary: additionalProperties-violation
      operation.method: POST
    reason: "Stripe silently drops unknown body fields by design (forward-compat)"

  - check: cross_call_references
    when:
      operation.path: /v1/subscription_schedules
      finding.message.contains: "write-only field"
    reason: "subscription_schedules has documented write-only fields (trial_settings)"

# Per-resource enum-override (расширение for spec_finding rollups)
rollups:
  - check: rate_limit_headers_absent
    auto_rollup_threshold: 50              # ≥50 individual findings того же class → 1 rollup MEDIUM, не N MEDIUM-ов

# Built-in vendor profiles (один shorthand для всех Stripe-isms)
profile: stripe                             # подгружает .zond/profiles/stripe.yaml — bundled known quirks
```

Bundled profiles в `src/core/severity/profiles/{stripe,github,gitlab,linear,resend,...}.yaml` — community-contributable.

## Acceptance Criteria

- [ ] #1 `core/severity/calibrator.ts` — load+merge config (workspace → API-level → built-in defaults), expose `calibrate(finding) → CalibratedFinding`. Findings emission path в `core/checks/runner.ts` и `core/probe/*.ts` проходит через calibrator до записи в ndjson/JSON envelope.
- [ ] #2 Config schema валидируется JSON-schema'ом на load; невалидный config → `zond config validate` exit 1 с конкретной location пути (`severity.yaml:checks.rate_limit_headers_absent: unknown severity 'mid', expected one of high|medium|low|info|suppressed`).
- [ ] #3 `when:` clauses поддерживают minimum: `response.headers.<name>`, `response.status`, `operation.{method,path,path_regex}`, `finding.{check,recommended_action,message_contains}`, `evidence.<deep.path>`. Field reference plain — не выражения (нет JS-эвала). Operators: `present|absent|equals|contains|matches|in`.
- [ ] #4 Suppressed findings emit'ятся как `severity: info-suppressed` + `suppressed_by: {file, rule_index, reason}` — присутствуют в ndjson для audit-trail, но НЕ считаются `--fail-on-coverage` / CI exit codes. `--show-suppressed` флаг показывает их в text-output.
- [ ] #5 Bundled profiles `stripe.yaml`, `github.yaml`, как proof-of-concept. Profile подключается через `profile: stripe` строкой в severity.yaml ИЛИ auto-detect по `base_url` matching `*.stripe.com` (с opt-out флагом).
- [ ] #6 `zond severity explain --finding <id>` — диагностика: показывает финальную severity + цепочку правил которые её определили (built-in default → workspace override → API override → suppression). Используется когда reader не понимает почему MEDIUM не HIGH.
- [ ] #7 Stripe ARV-282 dataset (raw/30-checks-depth.ndjson): after applying bundled `stripe.yaml` profile финальный summary table выдаёт ≤10 actionable findings вместо текущих 335 raw (≤97% noise reduction). Регрессионный тест на fixture'ом этом dataset.
- [ ] #8 Skill update: `init/templates/skills/zond.md` Phase 8 (coverage + gating) описывает severity config + ссылку на bundled profiles. `init/templates/skills/zond-triage.md` про `severity explain`.
- [ ] #9 Migration path: existing scans без `severity.yaml` ведут себя как сейчас (config optional). Внедрение `severity.yaml` — opt-in, никакого silent change поведения для существующих пользователей.

## Phasing (suggested)

- **Phase A** (AC#1-4): минимальный калибратор + suppressions + workspace-level config. Без bundled profiles, без `explain`. Уже разблокирует Stripe noise reduction вручную.
- **Phase B** (AC#5): bundled profiles + auto-detect.
- **Phase C** (AC#6, AC#7, AC#8): explain + regression test + skill docs. Готово к m-22 close-out.

## Non-goals (явно)

- Не альтернатива severity-cap для static `check spec` (ARV-255) — те правила и так capped LOW/INFO на check-level, не нужен per-API override.
- Не tolerated-drifts (`--learn-apply --learn-target drifts`) — те весят на test-suite level, severity-config работает на check/probe level.
- Не replacement для `recommended_action` enum — enum остаётся source-of-truth, config только маппит enum → severity.

## Edge cases / risks

- **Config drift**: вендорные quirks могут поменяться (Stripe внезапно adds `RateLimit-*`). Bundled profiles должны помечаться датой review + URL источника. Auto-detect должен warning'ом сообщать что profile старше N месяцев.
- **Suppression abuse**: команда может suppress'нуть всё подряд и получить green CI на красном API. Mitigation: `severity stats --json` показывает % findings suppressed; PR-review должен flag'ить >X% suppression.
- **Per-API vs workspace precedence**: documented order. Suppressions union (additive), severity overrides — per-API wins, but warning если оба override'ят один и тот же check.
- **Test fixture maintenance**: AC#7 regression test на raw ndjson быстро устареет (heuristics эволюционируют). Pin'нуть version + zond binary version в test fixture.

## Связано

- ARV-282 (Stripe scan, source dataset)
- ARV-255 (m-21 spec-lint severity cap — separate ось, не дублирует)
- ARV-256 (small-team value-add checks — те же проверки которые сейчас calibration требуют)
- ARV-272 (lifecycle inference — recommended_action mapping example)
- ARV-161 (form-encoded probe — пример где emit-correctness > severity-calibration; complementary)
<!-- SECTION:DESCRIPTION:END -->
