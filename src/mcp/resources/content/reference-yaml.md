# YAML Reference

Format for editing/fixing/writing zond test files.

## Suite skeleton
```yaml
name: "Suite name"
tags: [smoke]
base_url: "{{base_url}}"
headers:
  Authorization: "Bearer {{auth_token}}"
tests:
  - name: "Test name"
    GET: /endpoint
    expect:
      status: 200
      body:
        id: { type: integer }
```

## Assertions
- `equals`, `not_equals` — exact match
- `type` — `string`, `integer`, `number`, `boolean`, `array`, `object`
- `contains`, `not_contains` — substring match
- `matches` — regex
- `exists` — field presence
- `gt`, `lt`, `gte`, `lte` — numeric comparison
- `length`, `length_gt`, `length_lt` — array/string length
- `capture` — save value for later steps

Nested fields: `category.name: { equals: "Dogs" }` or `data.user.id: { type: integer }`. Root body: `_body: { type: "array" }`.

Status: `status: 200` or `status: [200, 204]`.

## Capture
```yaml
body:
  id: { capture: user_id }
```
Then use `{{user_id}}` in later steps. **Captures are file-scoped** — they do NOT propagate between suites. Each suite needing auth must login itself or use `.env.yaml`. Exception: `setup: true` suites share captures with all regular suites (see `zond://reference/auth-patterns`).

## ETag pattern
If-Match requires escaped quotes — `If-Match: "\"{{etag}}\""`. Same for If-None-Match. Always GET before PUT to capture the etag:
```yaml
- name: Get item (capture etag)
  GET: /items/{{item_id}}
  expect:
    status: 200
    body:
      etag: { capture: etag }
- name: Update item
  PUT: /items/{{item_id}}
  headers:
    If-Match: "\"{{etag}}\""
  json: { name: "updated" }
  expect:
    status: 200
```

## Generators
- `{{$randomEmail}}` — unique email
- `{{$randomName}}` — random name
- `{{$uuid}}` — UUID
- `{{$randomInt}}` — random integer
- `{{$timestamp}}` — Unix timestamp
- `{{$randomString}}` — random string

Generators in `set:` are evaluated **once** when the step executes — use `set:` to pin a generated value across multiple steps. To reuse the same generated value in a later step, either store it via `set:` or capture it from the response.

```yaml
- name: Prepare data
  set:
    test_email: "{{$randomEmail}}"
- name: Register
  POST: /auth/register
  json: { email: "{{test_email}}" }
  expect:
    status: 201
```

## Soft delete
Some APIs return `200` on DELETE with a status field instead of `404` — verify actual behavior before asserting status or absence of the resource.

## Body encodings
- `json:` → `application/json`
- `form:` → `application/x-www-form-urlencoded`
- `multipart:` → `multipart/form-data` (file uploads). Text fields as strings, file fields as objects with `file:` (path relative to the YAML file), optional `filename:` and `content_type:`:
```yaml
multipart:
  description: "My file"
  upload:
    file: ./fixtures/doc.pdf
    filename: doc.pdf
    content_type: application/pdf
```

## Flow control
```yaml
# Skip step conditionally
skip_if: "{{item_id}} == 0"

# Retry until condition
retry_until:
  condition: "{{status}} == completed"
  max_attempts: 5
  delay_ms: 1000

# Iterate over array
for_each:
  var: id
  in: "{{item_ids}}"
```

## Env files
- `.env.yaml` (default) or `.env.<name>.yaml` in tests dir or parent. Selected via `--env <name>`.
