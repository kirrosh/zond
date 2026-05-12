# Feedback R09 — full ceiling on Stripe + продуктовая оценка

Saved 2026-05-12. Сессия: 9 раундов fb-loop'а против Stripe. Финал —
pass-coverage 58% / hit-coverage 70% / 245 findings (92H/153M). См.
`~/Projects/zond-test/.fb-loop/rounds/feedback-09.md` + reports-09/.

## Что закрыто в этом цикле (commit'нуто)

- ARV-149 / ARV-150 / ARV-153 — F4 form-encoded support, action-POST semantics
- ARV-157 / ARV-158 / ARV-159 — fb-loop fixes из R04/R05
- ARV-160 — drafted zond-max-coverage skill (нужна адаптация в init templates)
- ARV-161 / ARV-162 — F18 (security probe form-aware) + F19 (quoted form values)

## Завёл сюда из R09 + final evaluation

### m-16 (bugs / UX / skill drift)

- ARV-163 — F14 SQLite lock retry/backoff на concurrent zond runs
- ARV-164 — probe security/MA: format-aware baseline POST (закрыть INCONCLUSIVE-BASE)
- ARV-165 — generator: format-aware random helpers (email/url/country/MCC/...)
- ARV-166 — skill: `--learn-apply test|drifts` как обязательная tail-фаза
- ARV-167 — skill/docs: pass-coverage — breadth, не quality + таблица real signals
- ARV-168 — docs/skill: workflow table `probe static vs checks run vs probe security`

### m-20 — новый майлстоун, state-aware contract checks

`backlog/milestones/m-20 - state-aware-contract-checks.md`

- ARV-169 — checks: cross-call-references (POST→GET shape diff)
- ARV-170 — probe: idempotency (двойной POST + Idempotency-Key)
- ARV-171 — probe: pagination/cursor invariants
- ARV-172 — `.api-resources.yaml` lifecycle + checker
- ARV-173 — recipe + probe webhooks (delivery + shape + retry)

### Strategy / research

- `strategy/vector-6-real-api-quality-signals.md` — research-pool: perf,
  concurrency, BOLA/RBAC, multi-tenant privacy, PII classification, version
  drift, docs drift, live-traffic recorder, chaos, business-invariants.
- `strategy/strategy.md` §4 — добавлен блок про m-20.
- `strategy/lessons.md` §F — pass-coverage как breadth-метрика; иерархия
  quality signals; certified levels L1–L4.

## TL;DR продуктовой оценки

Тестер оценил архитектуру в 9/10, reliability на mainstream APIs — 6/10
(много foundation-багов всплыло сразу на Stripe — F2/F4/F5), out-of-the-box
DX — 6/10 (без обновлённых skill'ов агент промахивается мимо probe-static
/ audit / `--learn-apply`). После цикла фиксов R02–R09 — 8/10 на mainstream
APIs.

Главный продуктовый инсайт: **pass-coverage 58% — proxy-метрика**, и
дорога к «зачётному» 80%+ лежит не через generator tuning (хотя ARV-165
дешёво даст +10–15%), а через **state-aware checks** (m-20). Если zond
хочет быть стандартом API-аудита, ему нужен слой между «per-call contract»
и «scenarios». Этот слой — vector-6.

## Что НЕ заводим в backlog (выше скоупа zond)

- Stripe Connect/Issuing/Treasury onboarding — out of audit scope, требует
  account-level действий на стороне target API. Снимает 567 fixture-blocked
  cells; обходится только ручным заполнением `.env.yaml`.
- Authentication-flow automation (OAuth/MFA/captcha) — в `claude-in-chrome`
  slot, не в zond.
- Chaos engineering — отдельный SRE-tool, zond может только потреблять
  signal.
- Business-logic invariants — domain-specific, идут в scenarios/ руками.

См. `strategy/vector-6-real-api-quality-signals.md` §«Принципы».
