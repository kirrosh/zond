---
name: warm-up-target
description: |
  Warm up the TARGET API's environment so honest-2xx coverage stops being
  capped by empty state. Picks up where `zond-seed` stops: the fixtures the
  API cannot self-create via a plain POST — a real error `issue_id` (needs an
  actual event), a `file_id` (needs a sourcemap/artifact upload), an
  `integration_id` (needs an OAuth/app install), a `webhook_event_id` (needs a
  replay). YOU decide HOW to warm each one using the target's OWN tooling (its
  SDK, CLI, dashboard, replay/trigger endpoints); then harvest the resulting
  LIVE id into `.env.yaml`. Use when honest-2xx is stuck low (~30%), when
  `zond-seed` / `prepare-fixtures` report roots as un-seedable / external-input,
  or the user asks to "warm up the target", "raise honest-2xx", "seed via the
  SDK", "generate real test data". zond only STORES the id and MEASURES the
  lift — the warm-up judgment is yours. Hand back to `zond` once warm.
allowed-tools: [Read, Write, Edit, Bash]
---

# warm-up-target — get the API into a testable state

`prepare-fixtures` reports fixture gaps; `zond-seed` fills the ones the API
self-serves (plain `POST` + capture). Whatever is left — resources that exist
only after a **real-world event** — is the honest-2xx ceiling. This skill
breaks that ceiling by warming the target with **its own means**, then storing
the live ids zond will reuse.

This is **not** core zond and **not** a heuristic: zond never learns how to
warm an API (that judgment has an infinite tail — every provider is different).
YOU read the provider's docs/SDK and drive it; zond only records the id
(`fixtures add`) and measures the coverage delta (`coverage`). Keep it that way
— no warm-up logic goes into zond core (litmus test).

## Iron rules

- **You warm, zond stores + measures.** You run the SDK/CLI/dashboard action
  that creates the real resource; you read the returned id; `zond fixtures add`
  writes it. Never ask zond to "figure out" how to warm a resource.
- **Live + throwaway/sandbox + cleanup.** Warm-ups create real state (events,
  files, installs). Confirm `base_url` is a sandbox/test account first. Track
  what you create; tear it down after (or use a disposable org). If you can't
  guarantee cleanup, ask before creating.
- **Hand off to `zond-seed` first.** Only warm what `zond-seed` marked
  un-seedable. Don't reinvent plain-POST creation here — that's zond-seed's job.
- **Report honestly what you can't warm.** Some fixtures need a human (a paid
  plan, a KYC step, a physical device, a manual dashboard toggle). Surface those
  as a short "needs you" list with the exact action — never fake a value (it
  just 422s and lies about coverage).
- **Measure the lift.** Snapshot honest-2xx before and after so the warm-up's
  value is visible (`zond coverage --api <name> --union session`).

## Inputs — what needs warming

| Signal | Command | What it tells you |
|---|---|---|
| Un-seedable roots | `zond-seed` handoff / `zond prepare-fixtures --api <name> --json` → `summary.fixtureGaps.unseededRoots[]` | fixtures no plain-POST can create |
| Empty-list gaps | `prepare-fixtures` items with `status: miss-empty` | resource exists in spec, zero records in the target |
| What each id is for | `apis/<name>/.api-resources.yaml` (the owning resource + its create/read endpoints) | which real-world action mints this id |
| Current honest-2xx | `zond coverage --api <name> --union session --json` | the ceiling you're trying to raise |

## Warm-up patterns (pick per resource)

The resource's *nature* tells you the warm-up path. Common families:

| Fixture shape | Warm-up path (via the target's own tooling) |
|---|---|
| Error / issue id (`issue_id`, `event_id`) | Trigger a real event: `sentry-cli send-event`, the app's error-report endpoint, or an SDK `captureException`. Poll the list endpoint until the id appears, capture it. |
| Uploaded-artifact id (`file_id`, `release`, `sourcemap`) | Upload via the provider CLI/SDK (`sentry-cli releases files upload`, a `POST .../files` multipart). Capture the returned id. |
| Integration / connection id (`integration_id`, `installation_id`) | Install the app/integration into a **sandbox** org (OAuth flow / provider dashboard "add to test workspace"). Capture the id from the callback or the list endpoint. |
| Delivered-webhook id (`delivery_id`, `webhook_event_id`) | Register a webhook, trigger the source event, replay/list deliveries, capture the id. |
| Provisioned-async id (needs a background job to finish) | Kick off the job, poll the status endpoint until ready, capture. |

These are *examples*, not a lookup table — read the actual provider's docs for
the target you're on.

## The loop

For each un-seedable root:

1. **Identify the warm-up path.** From `.api-resources.yaml` + the provider
   docs, decide which real-world action mints this id. If it needs a human,
   add it to the "needs you" list and move on.

2. **Warm it via the target's own tooling.** Run the SDK/CLI/curl that creates
   the real resource in the sandbox. Read the id from the response (or poll the
   list endpoint until it shows up — async resources aren't instant).

3. **Store the live id.**
   ```bash
   zond fixtures add --api <name> issue_id=<real-id-you-got> --validate --apply
   ```
   `--validate` GETs the read-by-id endpoint and confirms the id is `live`
   before writing (so a warm-up that half-failed doesn't poison later runs).

4. **Verify the gap closed.** Re-run `zond prepare-fixtures --api <name> --json`
   — the warmed root should drop out of `unseededRoots` / flip off `miss-empty`.

5. **Measure + hand back.** When the worklist is drained (or only "needs you"
   items remain), snapshot honest-2xx again and report the delta, then hand
   back to `zond` for the audit:
   ```bash
   zond coverage --api <name> --union session   # after — compare to the before snapshot
   ```

## Output to the user

- **Warmed:** table of `fixture → how it was warmed → live id captured`.
- **Needs you:** fixtures that require a human action, each with the exact step
  (e.g. "enable the Slack integration in the sandbox workspace, then re-run").
- **Coverage:** honest-2xx before → after, so the lift is measurable.

Cleanup: DELETE the resources you created (or note they live in a disposable
sandbox). Never leave test events/files/installs on a shared account.
