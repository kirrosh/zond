## API testing with zond

This workspace uses [zond](https://github.com/kirrosh/zond) for API testing. The full
workflow lives in MCP resources served by the `zond` MCP server (configured in
`~/.claude/mcp.json` and/or `~/.cursor/mcp.json`).

**Before working on tests, read these MCP resources in order:**

1. `zond://workflow/test-api` — end-to-end workflow (init → catalog → generate → smoke → CRUD → coverage)
2. `zond://rules/never` — mandatory NEVER rules (read before any action)
3. `zond://rules/safety` — `--safe` / `--dry-run` / environment gating

**MCP tools** (use these instead of the shell where possible):
`zond_init`, `zond_catalog`, `zond_describe`, `zond_run`, `zond_diagnose`, `zond_request`,
`zond_validate`, `zond_coverage`, `zond_sync`.

**If MCP is unavailable** in your client, fall back to:

```bash
zond --help
zond init --spec <path> --name <name>
zond run <tests-dir> --safe --json
zond db diagnose <run-id> --json
```
