# Auth Setup Patterns

For APIs with in-memory / session tokens that reset on server restart, hardcoding `auth_token` in `.env.yaml` breaks after each restart. Use a dedicated **setup suite** instead.

## Minimal setup.yaml

```yaml
name: setup
setup: true
tags: [setup]
base_url: "{{base_url}}"
tests:
  - name: Login
    POST: /auth/login
    json:
      username: "{{admin_username}}"
      password: "{{admin_password}}"
    expect:
      status: 200
      body:
        token: { capture: auth_token }
```

Fill `admin_username` / `admin_password` in `.env.yaml`.

## Rules for `setup: true` suites

- **Must capture** the token (add `capture: auth_token` to the response body field). Without it, no other suite can authenticate.
- **No logout step.** Logout invalidates the captured token for all following suites. If you need to test logout, put it in a dedicated non-setup suite.
- Captured variables override `.env.yaml` values in all regular suites automatically.
- Only one login step needed here — remove login steps from all other suites (otherwise they collide on rate limits).
- **Create `setup.yaml` immediately** when starting a new test project — adding it later means wasted debugging time chasing 401s.
- If the API has a reset endpoint (clears state), add it as the **first** step in `setup.yaml` with tag `[system, reset]` — never `[smoke]`. See `zond://rules/safety`.

## Static tokens

For long-lived API keys or JWTs that don't reset, hardcoding in `.env.yaml` is fine:
```yaml
# .env.yaml
auth_token: "Bearer xxxxxxxxxxxx"
admin_email: "ops@example.com"
```
Then in suites:
```yaml
headers:
  Authorization: "{{auth_token}}"
```

## Multi-user scenarios

When a scenario needs **multiple distinct users**, capture per-user tokens inside the scenario file (not setup):
```yaml
- name: Register new user
  POST: /auth/register
  json:
    email: "{{$randomEmail}}"
    password: "TestPass123!"
  expect:
    status: 201
    body:
      token: { capture: new_user_token }

- name: Act as new user
  GET: /me
  headers:
    Authorization: "Bearer {{new_user_token}}"
```
Setup-suite token (`{{auth_token}}`) is still available for admin operations in the same scenario.

## Tag interplay with --tag filtering

Setup suites only run when their tag is in `--tag`. Always include the setup tag when filtering:
```bash
zond run <tests-dir> --tag crud,setup --json
zond run <tests-dir> --tag scenario,registration,setup --json
```
See `zond://rules/safety` for the full filtering rules.
