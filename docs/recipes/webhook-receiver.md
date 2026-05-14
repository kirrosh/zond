# Recipe: webhook shape-conformance with `zond probe webhooks`

> m-20 ARV-173. Capture real webhook events with an off-the-shelf
> receiver, then validate them against `spec.webhooks` via
> `zond probe webhooks --event-log`.
>
> Same recipe/probe split as
> [`quicktype.md`](./quicktype.md) and [`interactsh.md`](./interactsh.md)
> — live infrastructure lives in the recipe, deterministic
> verification lives in the probe.

## What this recipe answers

- Does the server send the webhook payload shape it advertised in
  `spec.webhooks.<event>.post.requestBody`?
- Does the captured event log carry only event types the spec
  declares?
- Do all required fields land on the wire?

The probe is **offline**: it consumes an ndjson event log (one JSON
event per line, the format every modern webhook CLI emits) and
validates each payload. Capturing the log is the recipe's job —
`zond` does not bind ports or open tunnels.

## When to use it

Pre-flight a webhook integration on Stripe, GitHub, Shopify, Linear,
or any API that publishes `webhooks:` (OpenAPI 3.1) or `x-webhooks`
in its spec. Typical setup time **< 15 minutes** on Stripe test mode.

## Prerequisites

- `zond` ≥ ARV-173 build.
- The API's spec has a `webhooks:` block (OpenAPI 3.1) or
  `x-webhooks` extension. Verify with `jq '.webhooks // ."x-webhooks" |
  keys' apis/<name>/spec.json`. No block → recipe is not applicable.
- Local capture tool. **Stripe CLI** is the easiest path for Stripe;
  for other vendors, [`smee.io`](https://smee.io) and ngrok work too.

## Stripe (recommended — 5-minute path)

### 1. Install Stripe CLI

```bash
brew install stripe/stripe-cli/stripe   # macOS
# Or: https://stripe.com/docs/stripe-cli#install
stripe login                            # OAuth — opens the dashboard
```

### 2. Capture events

`stripe listen` registers a temporary forwarding endpoint with your
test-mode account and prints every delivery to stdout. The
`--print-json` flag emits one full event per line — exactly the
ndjson format `zond probe webhooks` expects.

```bash
stripe listen --print-json > events.jsonl
```

Leave that running in a separate terminal. In the original terminal,
trigger a few events:

```bash
stripe trigger charge.succeeded
stripe trigger customer.created
stripe trigger checkout.session.completed
```

`stripe trigger` creates a synthetic resource that mints the named
event server-side, with no real money involved. After ~10 seconds
stop `stripe listen` (`^C`); the file `events.jsonl` now contains 3+
events.

### 3. Validate

```bash
zond probe webhooks --api stripe --event-log events.jsonl
```

Output is a markdown digest with per-type counts (`ok / drift /
unknown`) and a finding list. `--report json` or `--json` switch the
shape for CI / automation.

Exit code:
- `0` — no HIGH findings (shape-drift). LOW noise (unknown event
  types, missing payloads) doesn't gate CI.
- `1` — one or more HIGH shape-drift findings.
- `2` — CLI or IO error (missing file, bad JSON spec).

## Non-Stripe targets

Pick **one** of three capture strategies depending on what your
target API supports:

### A. `smee.io` (universal, zero install)

1. Open `https://smee.io` and click **"Start a new channel"** —
   you'll get a URL like `https://smee.io/abc123XYZ`.
2. Register that URL as a webhook endpoint in the target API
   (dashboard or `POST /webhooks` if their spec exposes it).
3. Install the CLI tunnel and pipe to a file:

   ```bash
   npx smee-client -u https://smee.io/abc123XYZ \
       -t http://localhost:9000/log
   # In another terminal, capture deliveries:
   nc -lk 9000 | grep -v '^$' > events.jsonl
   ```

   (`nc` shows raw HTTP requests; `jq` post-processing may be needed
   to strip headers — see "Event log format" below.)

### B. ngrok (HTTPS tunnel to a local server)

```bash
ngrok http 9000                                            # in terminal 1
# Note the https URL ngrok prints; register it in the API dashboard.

bun -e '
  Bun.serve({
    port: 9000,
    async fetch(req) {
      const body = await req.text();
      await Bun.write("events.jsonl", body + "\n", { append: true });
      return new Response("ok");
    }
  });
'                                                          # in terminal 2
```

### C. Captured-by-prod log

If your target API is already wired up in production and you have
access to the receiver's request log, just extract one body per line
into `events.jsonl`. The probe doesn't care where the events came
from.

## Event log format

The probe expects ndjson — one JSON object per line — and recognises
three envelope shapes:

| Source | Detected payload location |
|---|---|
| Stripe (`stripe listen --print-json`) | `data.object` |
| GitHub / Slack-style | `body` |
| Generic | `payload` |

If your capture tool dumps headers + body together, post-process
with `jq` to keep only the bodies:

```bash
jq -c '.body // .' raw-capture.jsonl > events.jsonl
```

## Filtering event types

`--only charge.succeeded,customer.created` restricts validation to a
subset. Useful when:
- A long capture session collected many noisy event types and you
  only care about a few.
- You're CI-gating a specific integration and don't want unrelated
  events to surface as `unknown_event_type`.

## Anti-FP guards

- **Missing payload** (no `data.object` / `body` / `payload` key)
  surfaces as LOW, not HIGH — the probe assumes a capture-tool quirk
  before assuming a server bug. Re-check the recipe section above.
- **Unknown event type** (event `type` not in `spec.webhooks`) is LOW
  too. Stripe ships ~200 event types; most specs declare only a
  handful publicly. Use `--only` to silence the noise.
- **Shape drift** is the HIGH gate. If you see drift on a stable
  event like `charge.succeeded`, double-check the spec is current
  (`zond refresh-api`) before filing an issue.

## What this recipe does NOT cover

- **Retry-policy verification.** Simulating receiver 5xx to assert
  the server retries is a stateful test, not shape conformance.
  Future work.
- **Ordering invariants.** Out-of-order delivery is a property of
  the channel, not the payload. Future work.
- **HMAC signature verification.** Webhook signing belongs in
  `zond run` recipes (use the API's docs for the signature scheme).

If you need any of the above, write a `zond run` scenario that
drives the trigger and asserts against the live receiver. The shape
probe covers the contract; the scenario covers the delivery.
