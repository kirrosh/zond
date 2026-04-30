## API testing with zond

This workspace uses [zond](https://github.com/kirrosh/zond) for API testing — CLI
only, no MCP server in this workspace.

**Full playbook:** `.claude/skills/zond/SKILL.md` (auto-discovered by Claude Code;
plain markdown for Codex/Cursor/Aider). The skill is the single source of truth
for the workflow, rules, fixture-pack, probe templates, diagnose flow, and
reporting. Don't duplicate workflow steps here — read the skill.

For multi-step user journeys / fixture creation through the API, use
`.claude/skills/zond-scenarios/SKILL.md` instead.

### Mandatory rules (mirrored from the skill — non-negotiable)

- **NEVER** read OpenAPI/Swagger files with Read/cat — use `zond describe`,
  `zond catalog`, or the generated `.api-catalog.yaml`.
- **NEVER** use curl/wget — use `zond request <method> <url>`.
- **NEVER** write test YAML from scratch — start with `zond generate`, then edit failures.
- **NEVER** hardcode tokens — `apis/<name>/.env.yaml` (auto-gitignored), reference as `{{auth_token}}`.
- **`recommended_action: report_backend_bug` (5xx) → STOP**, do not edit
  assertions to make the test pass.
