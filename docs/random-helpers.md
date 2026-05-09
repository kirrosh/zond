# `$random*` helpers

`{{$name}}` placeholders inside test YAML are resolved at run time by built-in
generators. They are useful for synthesising bodies and path params when you
don't want to track per-fixture values in `.env.yaml`. Helper output is
re-rolled on every reference — capture into a variable if you need a value
to stay stable across steps.

## Catalog

| Helper            | Example output                              | Use for                              |
|-------------------|---------------------------------------------|--------------------------------------|
| `{{$uuid}}`       | `9c3a…-…-…-…-…` (RFC 4122)                  | Idempotency-Key, opaque resource ids |
| `{{$timestamp}}`  | `1715251200` (UNIX seconds)                 | `created_at`, monotonic seeds        |
| `{{$isoTimestamp}}` / `{{$randomIsoDate}}` | `2026-05-09T12:34:56.000Z` | RFC 3339 timestamps |
| `{{$randomName}}` | `Alice Brown`                               | display names                        |
| `{{$randomEmail}}`| `qbn1k9zc@test.com`                         | unique e-mail bodies                 |
| `{{$randomInt}}`  | `7421` (0–9999)                             | small numeric ids, pagination cursors |
| `{{$randomString}}` | `aA9zXm0Q` (8 chars, alphanumeric mixed-case) | opaque tokens, password fields |
| `{{$randomSlug}}` | `qb1nk9zc` (8 chars, lowercase + digits)    | `slug` / `handle` / URL-safe ids     |
| `{{$randomUrl}}`  | `https://example-abc12345.com/path`         | webhook / callback URL fields        |
| `{{$randomFqdn}}` / `{{$randomDomain}}` | `test-abc12345.example.com` | DNS / hostname inputs |
| `{{$randomIpv4}}` | `10.42.7.118` (RFC 1918 range)              | client_ip / source_ip body fields    |
| `{{$randomDate}}` | `2025-11-04`                                | calendar dates                       |
| `{{$nullByte}}`   | `" "` (a single space)                      | placeholder where the API rejects empty strings |

The slug/email/url/fqdn/ipv4 helpers all draw 8 characters from a fixed pool
so that two adjacent calls almost never collide; if you need a guaranteed
unique value across a session, capture once and reuse:

```yaml
set:
  ticket_slug: "{{$randomSlug}}"
- POST: /tickets
  json: { slug: "{{ticket_slug}}" }
- GET: /tickets/{{ticket_slug}}
```

## How `zond generate` chooses a helper

When `zond generate` produces a positive smoke suite, it picks helpers based
on the field schema:

- `format: email` → `$randomEmail`
- `format: uri` / `url` → `$randomUrl`
- `format: hostname` → `$randomFqdn`
- `format: ipv4` → `$randomIpv4`
- `format: uuid` → `$uuid`
- `format: date` → `$randomDate`
- `format: date-time` → `$randomIsoDate`
- field name matches `slug` / `handle` → `$randomSlug`
- pure `string` → `$randomString`
- pure `integer` → `$randomInt`

If none of the above fit, the generator falls back to a literal value from
the spec's `example` or `enum` clause.

## Listing from the CLI

```sh
zond reference random-helpers           # human-readable table
zond reference random-helpers --json    # machine-readable list (for skills)
```
