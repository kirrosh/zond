# m-28 launch pack (ARV-408): Show HN + Reddit + FAQ + тайминг

Готовые к копипасту тексты. Публикация — вручную (внешние системы).
Релиз-основа: **v0.28.0** (fuzz + все corpus-фиксы уже в npm/releases).

## Baseline-метрики (сняты 2026-07-11, ДО поста — AC #1)

| метрика | значение |
|---|---|
| GitHub stars | 0 |
| forks / watchers | 0 / 0 |
| npm downloads, last-month (2026-06-11…07-10) | 836 |
| npm downloads, last-week (2026-07-04…07-10) | 729 |

После поста снять те же 4 числа + зафиксировать первый внешний сигнал
(звезда/issue/коммент) — AC #3.

## Тайминг (рекомендация)

- **Понедельник 2026-07-13, 15:00–16:00 МСК** (8–9am ET) — пик HN-трафика,
  до полудня восточного времени. Сегодня суббота — постить в выходные не надо:
  меньше глаз, и «second-chance pool» HN активнее в будни.
- Reddit r/ClaudeAI — тот же день, через 2–3 часа после HN (не одновременно,
  чтобы отвечать на комменты успевать). r/programming — только если HN-пост
  наберёт трекшн (там жёстко к self-promotion).
- Весь день понедельника держать свободным для ответов в комментах — первый
  час решает всё.

## Show HN — title (≤80 chars)

```
Show HN: Zond – API contract-drift scanner; we audited GitHub, Vercel, Stripe
```

Запасной (если хочется цифру в заголовке):

```
Show HN: Half of GitHub's read endpoints return status codes its spec omits
```

URL: `https://github.com/kirrosh/zond`

## Show HN — text (первый коммент / текст поста)

```
I built zond, an API hygiene scanner for small teams and their coding
agents — it tests REST endpoints against the OpenAPI spec, catches contract
drift, and tracks coverage. To find out whether it's actually useful, I ran
it against three well-known public APIs and wrote up everything, including
what it got wrong:

- GitHub (read-only, 625 ops, ~3.5 min): two live 200s that fail their own
  published schema (GET /orgs/{org} returns null for fields declared
  non-nullable), and ~164 read endpoints returning status codes the spec
  never declares. Zero server bugs — pure spec drift.
  https://github.com/kirrosh/zond/blob/master/docs/case-studies/github-rest-api.md

- Vercel (live, throwaway account): one intermittent HTTP 500, ~150 ops with
  undeclared 404/405s, ~45 create endpoints that reject bodies the spec calls
  valid. The scary part: zond's own generated suite included DELETE /v1/user —
  catching that before running it changed the tool (unsafe suites are now
  disarmed by default).
  https://github.com/kirrosh/zond/blob/master/docs/case-studies/vercel-api.md

- Stripe (test mode): walked draft→finalize→pay/void live, 15/15 green. The
  best finding was against my own tool: a generic scanner defaults bodies to
  currency=usd, the account was EUR, and that mismatch silently zeroes the
  invoice so it finalizes straight to "paid" — a fuzzer reports green while
  testing none of the state machine.
  https://github.com/kirrosh/zond/blob/master/docs/case-studies/stripe-lifecycle.md

I also ran Schemathesis head-to-head on the same 112 Stripe endpoints and
published the honest gap list in both directions (they had a fuzzing engine
we lacked — v0.28.0 adds a fast-check-based fuzz phase with shrinking as a
direct result; they still have stateful link inference we don't):
https://github.com/kirrosh/zond/blob/master/docs/case-studies/zond-vs-schemathesis.md

Design choices that might be interesting:

- Agent-first, no LLM inside. zond is a deterministic CLI: it dumps
  machine-readable state, your coding agent reasons about it, and applies
  YAML back. Severity judgment, false-positive triage, and "is this a bug or
  a doc gap" stay with the agent (or you) — the tool never guesses.

- Safe by default. Read-only unless you opt into live mode; generated
  destructive suites ship disarmed; live mode only mutates resources it
  created itself.

- No evidence, no HIGH severity. On mature APIs almost all raw findings are
  noise (Stripe's semantic validation rejects any schema-shaped garbage —
  965 raw findings calibrated to 0 real HIGH). Calibration is the product.

Install: curl -fsSL https://raw.githubusercontent.com/kirrosh/zond/master/install.sh | sh
(or npm i -g @kirrosh/zond). MIT, single binary (Bun), works standalone or
as Claude Code / agent skills.
```

## FAQ — заготовки ответов на комменты

**"How is this different from Schemathesis?"**
> Neither is a superset — I published the measurement rather than claiming a
> win. Schemathesis has Hypothesis-based fuzzing with stateful link inference;
> zond has 7 checks it lacks (idempotency replay, lifecycle state machines,
> cross-call reference integrity, pagination invariants…), severity
> calibration, and fixture seeding to get past auth/parent-resource walls.
> On the same 112 Stripe ops both found the same load-bearing result (zero
> 5xx) and the same noise. Full head-to-head: [link]. v0.28.0 closed the
> fuzzing gap with a fast-check phase + shrinking.

**"Why not Postman/Bruno/Insomnia?"**
> Those are collection runners — you author requests by hand and they replay
> them. zond starts from the OpenAPI spec: generates the suites, seeds
> fixtures, runs depth checks the collection tools have no concept of
> (schema conformance on every response, undeclared-status detection,
> lifecycle transitions), and diffs behavior across runs. It's closer to
> Schemathesis than to Postman.

**"Is it safe to point at a live API?"**
> Safe mode is the default (read-only + boundary values on reads). Live mode
> only mutates resources it created itself in the same run; generated
> destructive suites are disarmed by default (skip unless you set an explicit
> arm variable). The Vercel case study documents exactly this: the generated
> suite contained DELETE /v1/user and the disarm-by-default behavior exists
> because of it.

**"Where's the LLM? / Is this another AI tool?"**
> There's no LLM inside — zond is a deterministic CLI. The 'agent' part is
> that its output is machine-readable and its inputs are YAML overlays, so a
> coding agent (Claude Code, Cursor, whatever) can drive it in a loop: dump →
> reason → apply. Everything requiring judgment (severity, is-this-a-bug) is
> deliberately left to the agent or the human. It works fine with no agent at
> all.

**"Did you report these to GitHub/Vercel/Stripe?"**
> There's nothing security-relevant to report — zero auth bypasses, zero
> data leaks; that's stated plainly in every case study. The findings are
> spec/documentation drift (undeclared status codes, nullable fields typed
> non-nullable). The Vercel intermittent 500 is the only server-side issue,
> visible to them in their own telemetry.

**"965 findings calibrated to 0 — so the tool found nothing?"**
> It found that the raw signal was noise, and said so — that's the feature.
> A tool that dumps 201 flat 'failures' on a healthy API (what the
> uncalibrated run looks like) trains you to ignore it. The GitHub/Vercel
> runs show the opposite case: real drift survives calibration and gets
> reported as a short list.

**"Single data point / cherry-picked targets?"**
> Four targets so far (Sentry was the pilot), all published with raw numbers
> and the misses (honest-2xx caps, INCONCLUSIVE probes, what stayed
> untested and why). If you have an API you'd like it run against, the
> /zond-scan convention is in the repo.

## Reddit r/ClaudeAI — пост

Title:
```
I built an API scanner designed to be driven by Claude Code — no LLM inside, the agent does the judgment. Audited GitHub/Vercel/Stripe with it.
```

Body:
```
zond is a deterministic CLI (single binary): it reads an OpenAPI spec,
generates test suites, runs conformance/security checks, and emits
machine-readable JSON. The design bet: the tool never judges — Claude reads
the dumps, decides severity, authors seed bodies as YAML overlays, and drives
the loop (dump → reason → apply).

It ships as Claude Code skills (/plugin marketplace add kirrosh/zond), and
the whole audit is one slash command: /zond-scan <spec-url>.

To test the model, Claude drove full audits of GitHub, Vercel and Stripe.
Favorite moment: on Stripe, the generic scanner default (currency=usd) on a
EUR account silently zeroed an invoice so it finalized straight to "paid" —
Claude read three consecutive 400s, inferred the account currency, fixed the
seed, and walked the real draft→finalize→pay state machine 15/15 green. A
fuzzer would have reported green while testing nothing.

Case studies (including everything the tool got wrong):
https://github.com/kirrosh/zond/tree/master/docs/case-studies

Show HN thread: [link after posting]
```

## Демо

Демо = кейсы + quick-start в посте (обе вещи уже публичны). Отдельная
asciinema-запись — опционально: если делать, то 60-сек прогон
`/zond-scan` на petstore-подобном публичном спеке, без ключей. Решение —
после реакции на пост; для launch достаточно кейсов.

## Чеклист публикации (что делает пользователь)

1. [ ] Пн 13.07 ~15:00 МСК: submit Show HN (URL = репо, text = блок выше).
2. [ ] Сразу после: первый коммент от автора не нужен (текст уже в посте);
       отвечать на комменты FAQ-заготовками, переписывая под вопрос.
3. [ ] +2–3 ч: пост в r/ClaudeAI, вставить ссылку на HN-тред.
4. [ ] Вечером: снять те же 4 baseline-метрики, вписать сюда (AC #3).
5. [ ] r/programming — только при трекшне на HN.
