# BACKLOG — AI-Native API Testing Strategy (Archived)

> Archived: all milestones M22-M27 completed. See BACKLOG.md for current backlog.

---

## M22: MCP-First Smart Test Generation ✅ DONE

- `generate_tests_guide` tool — полная API-спека + алгоритм генерации + YAML format reference
- `save_test_suite` tool — парсит YAML, валидирует через Zod, сохраняет
- `explore_api` enhanced — `includeSchemas: true` → request/response schemas
- `schema-utils.ts` — `compressSchema()`, `formatParam()`
- Удалён `list_environments` (дубликат `manage_environment`)

## M23: Runner Improvements + MCP Refinements ✅ DONE

- Nested body assertions — `flattenBodyAssertions` preprocessor
- Root body assertions (`_body`) — `_body: { type: "array" }`, `_body.length: { gt: 0 }`
- `setup_api` MCP tool
- `generate_missing_tests` MCP tool
- Исправлен `z.record()` баг (MCP SDK 1.27.1)
- int64 workaround документирован

## M24: Tags + Description Support ✅ DONE

- `tags: string[]` и `description: string` в TestSuite
- `filterSuitesByTags()` — OR logic, case-insensitive
- CLI `--tag` флаг (repeatable, comma-separated)
- MCP `run_tests` — параметр `tag: string[]`
- Console reporter — отображение тегов

## M25: MCP + CLI Cleanup ✅ DONE

- `query_db` — consolidated 4 tools into 1 (list_collections, list_runs, get_run_results, diagnose_failure)
- Deleted dead code (`list-environments.ts`)
- Removed `request` CLI command

## M26: WebUI Simplification ✅ DONE

- Single-page dashboard: collection selector → env → Run Tests → results + coverage + history
- Removed 8 routes, extracted shared views
- JUnit XML + JSON export buttons

## M27: CI/CD Integration (partial) ✅ DONE

- `apitool ci init` CLI command (GitHub Actions, GitLab CI)
- `ci_init` MCP tool with `dir` param
- Templates: permissions, continue-on-error, publish-unit-test-result-action, repository_dispatch
- Agent hints: run_tests, save_test_suite, generate_tests_guide suggest CI after tests pass
- `docs/ci.md` — guide with triggers, secrets, examples

---

## Стратегия и принципы

Перенесены в APITOOL.md.
