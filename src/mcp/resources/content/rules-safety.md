# Safety Rules

Always read this before running tests against a real environment.

## Run-modes
- `--safe` → only GET requests execute. Smoke tests must use this against any environment that is not strictly disposable.
- `--dry-run` → shows requests without sending. Use to preview a freshly generated suite before any HTTP traffic.

## Environment gating
- **Never run CRUD tests unless the user has explicitly confirmed staging/test environment.** "It's our backend" is not enough — confirm the URL and that data loss is acceptable.
- Production credentials in `.env.yaml` → `--safe` only. No exceptions.
- Treat reset/flush/purge endpoints as destructive. They must be tagged `[system, reset]` (or `[unsafe]`), never `[smoke]`. `--safe` mode skips them; tag-filtered runs include them only if the tag is named explicitly.

## Failures vs. backend bugs
- If an endpoint returns 5xx, **keep `status: 200` (or whatever the spec says) in `expect`** — the test failing is correct: it surfaced an API bug.
- Never edit assertions to "make a test pass" when `recommended_action` is `report_backend_bug`. See `zond://workflow/diagnosis`.

## Tag filtering safety
- `--tag <group>` filters suites by tag. Setup suites only run when their tag is in the list. Always include the setup suite's tag (e.g. `--tag crud,setup`) — otherwise protected endpoints get 401 and the run looks falsely broken.
- `--exclude-tag` removes suites — use `--exclude-tag unsafe` (or `reset`) when running broad sweeps.

## Auth-debug discipline
- Don't use `zond request` against auth endpoints to debug 401/403. Each manual call burns rate-limit budget. Use `zond db diagnose <run-id>` and existing run results instead.
- If repeated 401s point to a token issue, the fix is in `setup.yaml` / `.env.yaml`, not in repeated logins (see `zond://reference/auth-patterns`).
