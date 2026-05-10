import { sendAdHocRequest } from "../../core/runner/send-request.ts";
import { printError, printSuccess, printWarning } from "../output.ts";
import { jsonOk, jsonError, printJson, zerr } from "../json-envelope.ts";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createSchemaValidator } from "../../core/runner/schema-validator.ts";
import { readOpenApiSpec } from "../../core/generator/openapi-reader.ts";
import { resolveCollectionSpec } from "../../core/setup-api.ts";
import { findCollectionByNameOrId } from "../../db/queries.ts";
import { getDb } from "../../db/schema.ts";
import type { AssertionResult } from "../../core/runner/types.ts";

// TASK-272: when the request fails authentication (401/403) and the user
// did NOT pass `--api <name>`, surface a one-liner pointing at auto-auth via
// `apis/<name>/.secrets.yaml`. Only fires if an apis/ workspace exists in cwd
// (otherwise the hint is irrelevant). Also triggered when the headers contain a
// literal unexpanded shell-substitution shape ($(…) or `…`) — a tell-tale of a
// blocked-by-sandbox manual auth attempt.
function detectApisWorkspace(cwd: string): string[] {
  const apisDir = join(cwd, "apis");
  if (!existsSync(apisDir)) return [];
  try {
    return readdirSync(apisDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

function looksLikeBlockedShellSubstitution(s: string | undefined): boolean {
  if (!s) return false;
  // unexpanded `$(...)` or backtick `...` with a likely secret-fetching command
  return /\$\([^)]+\)|`[^`]+`/.test(s) && /yq|cat|jq|grep|awk|sed|sh /.test(s);
}

function authHintLines(apis: string[]): string[] {
  const example = apis[0] ?? "<name>";
  return [
    `Hint: pass \`--api ${example}\` to auto-load Authorization from apis/${example}/.secrets.yaml`,
    `      (avoids manual "$(yq ...)" shell substitution and keeps secrets out of shell history).`,
  ];
}

export interface RequestOptions {
  method: string;
  url: string;
  headers?: string[];
  body?: string;
  timeout?: number;
  env?: string;
  api?: string;
  jsonPath?: string;
  dbPath?: string;
  json?: boolean;
  /** TASK-142: validate the response body against the OpenAPI response schema. */
  validateSchema?: boolean;
  /** TASK-142: explicit "METHOD:/path" override when path-templating heuristics
   *  fail or the user wants to validate against a different endpoint. */
  validateAgainst?: string;
}

interface SchemaValidationOutcome {
  status: "PASS" | "FAIL" | "no-spec" | "no-endpoint" | "no-schema";
  matchedEndpoint: { method: string; path: string } | null;
  matchedResponseStatus: string | null;
  errors: AssertionResult[];
  message?: string;
}

export async function requestCommand(options: RequestOptions): Promise<number> {
  try {
    const headers: Record<string, string> = {};
    if (options.headers) {
      for (const h of options.headers) {
        const colonIdx = h.indexOf(":");
        if (colonIdx > 0) {
          headers[h.slice(0, colonIdx).trim()] = h.slice(colonIdx + 1).trim();
        }
      }
    }

    const result = await sendAdHocRequest({
      method: options.method.toUpperCase(),
      url: options.url,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      body: options.body,
      timeout: options.timeout,
      envName: options.env,
      collectionName: options.api,
      jsonPath: options.jsonPath,
      dbPath: options.dbPath,
    });

    let validation: SchemaValidationOutcome | null = null;
    if (options.validateSchema || options.validateAgainst) {
      validation = await runSchemaValidation(options, result);
    }

    if (options.json) {
      printJson(jsonOk("request", validation ? { ...result, schema_validation: validation } : result));
    } else if (options.jsonPath) {
      // TASK-133: pipe-friendly mode — print only the extracted value.
      // Scalars (string/number/bool) emit verbatim with no JSON quoting so
      // shells can use the output directly (e.g. `id=$(zond request … --json-path data.id)`).
      // null/undefined → empty line. Objects/arrays → compact JSON.
      const v = result.body;
      if (v === null || v === undefined) {
        console.log("");
      } else if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        console.log(String(v));
      } else {
        console.log(JSON.stringify(v));
      }
      if (validation) printSchemaValidation(validation);
    } else {
      console.log(JSON.stringify(result, null, 2));
      if (validation) printSchemaValidation(validation);
    }

    // TASK-272: post-response auto-auth hint on 401/403 without --api
    if (
      !options.json
      && (result.status === 401 || result.status === 403)
      && !options.api
    ) {
      const apis = detectApisWorkspace(process.cwd());
      if (apis.length > 0) {
        for (const line of authHintLines(apis)) console.error(line);
      }
    }
    if (validation && validation.status === "FAIL") return 1;
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (options.json) {
      const code = /not registered/.test(message) ? "api_not_registered" : "unknown_error";
      printJson(jsonError("request", [zerr(code, message)]));
    } else {
      printError(message);
      // TASK-272: if the failure is shaped like blocked shell-substitution in
      // body/header (sandbox refused to expand `$(yq ...)`), point users at
      // `--api <name>` auto-auth instead.
      const headerBlob = (options.headers ?? []).join("\n");
      if (
        !options.api
        && (looksLikeBlockedShellSubstitution(options.body) || looksLikeBlockedShellSubstitution(headerBlob))
      ) {
        const apis = detectApisWorkspace(process.cwd());
        if (apis.length > 0) {
          for (const line of authHintLines(apis)) console.error(line);
        }
      }
    }
    return 1;
  }
}

// ──────────────────────────────────────────────
// TASK-142: --validate-schema / --validate-against
// ──────────────────────────────────────────────

async function runSchemaValidation(
  options: RequestOptions,
  result: { status: number; body: unknown },
): Promise<SchemaValidationOutcome> {
  if (!options.api) {
    return {
      status: "no-spec",
      matchedEndpoint: null,
      matchedResponseStatus: null,
      errors: [],
      message: "schema validation requires --api <name> (the spec is loaded from the registered collection)",
    };
  }

  getDb(options.dbPath);
  const col = findCollectionByNameOrId(options.api);
  if (!col?.openapi_spec) {
    return {
      status: "no-spec",
      matchedEndpoint: null,
      matchedResponseStatus: null,
      errors: [],
      message: `collection '${options.api}' has no openapi_spec — register one with \`zond add api ${options.api} --spec <path>\``,
    };
  }

  let doc;
  try {
    doc = await readOpenApiSpec(resolveCollectionSpec(col.openapi_spec));
  } catch (err) {
    return {
      status: "no-spec",
      matchedEndpoint: null,
      matchedResponseStatus: null,
      errors: [],
      message: `failed to load OpenAPI spec: ${(err as Error).message}`,
    };
  }

  let method: string;
  let path: string;
  if (options.validateAgainst) {
    const parsed = parseMethodPathArg(options.validateAgainst);
    if (!parsed) {
      return {
        status: "no-endpoint",
        matchedEndpoint: null,
        matchedResponseStatus: null,
        errors: [],
        message: `--validate-against expects "METHOD:/path" (e.g. "GET:/users/{id}"), got: ${options.validateAgainst}`,
      };
    }
    method = parsed.method;
    path = parsed.path;
  } else {
    method = options.method.toUpperCase();
    path = extractPath(options.url);
  }

  const validator = createSchemaValidator(doc);
  const inspect = validator.inspect(method, path, result.status);

  if (!inspect.matchedEndpoint) {
    return {
      status: "no-endpoint",
      matchedEndpoint: null,
      matchedResponseStatus: null,
      errors: [],
      message: `no spec endpoint matches ${method} ${path}. Pass \`--validate-against "METHOD:/path"\` (use spec template form, e.g. "GET:/users/{id}") to override.`,
    };
  }
  if (!inspect.hasJsonSchema) {
    return {
      status: "no-schema",
      matchedEndpoint: inspect.matchedEndpoint,
      matchedResponseStatus: inspect.matchedResponseStatus,
      errors: [],
      message: `endpoint ${inspect.matchedEndpoint.method} ${inspect.matchedEndpoint.path} has no application/json schema for status ${result.status} (matched branch: ${inspect.matchedResponseStatus ?? "none"})`,
    };
  }

  const errors = validator.validate(method, path, result.status, result.body);
  return {
    status: errors.length === 0 ? "PASS" : "FAIL",
    matchedEndpoint: inspect.matchedEndpoint,
    matchedResponseStatus: inspect.matchedResponseStatus,
    errors,
  };
}

function printSchemaValidation(v: SchemaValidationOutcome): void {
  const ep = v.matchedEndpoint ? `${v.matchedEndpoint.method} ${v.matchedEndpoint.path}` : "—";
  const branch = v.matchedResponseStatus ?? "—";
  console.log("");
  console.log(`Schema validation: ${v.status}`);
  console.log(`  endpoint:        ${ep}`);
  console.log(`  response branch: ${branch}`);
  if (v.message) console.log(`  ${v.message}`);
  if (v.status === "FAIL") {
    for (const e of v.errors) {
      console.log(`  • ${e.field} — ${e.rule}: ${e.expected}`);
    }
  }
  if (v.status === "no-endpoint" || v.status === "no-spec" || v.status === "no-schema") {
    printWarning(v.message ?? `validation skipped: ${v.status}`);
  } else if (v.status === "PASS") {
    printSuccess("response body matches the response schema");
  }
}

function parseMethodPathArg(raw: string): { method: string; path: string } | null {
  const m = raw.match(/^\s*([A-Za-z]+)\s*[: ]\s*(\/.*?)\s*$/);
  if (!m) return null;
  return { method: m[1]!.toUpperCase(), path: m[2]! };
}

function extractPath(url: string): string {
  // Absolute URL → use URL parser. Relative URL ("/users/1") → use as-is.
  if (/^https?:\/\//i.test(url)) {
    try {
      return new URL(url).pathname;
    } catch {
      return url;
    }
  }
  // Strip query string from relative paths.
  const q = url.indexOf("?");
  return q >= 0 ? url.slice(0, q) : url;
}

import type { Command } from "commander";
import { globalJson } from "../resolve.ts";
import { collect, parsePositiveInt } from "../argv.ts";
import { getApi } from "../util/api-context.ts";
import { loadEnvMeta } from "../../core/parser/variables.ts";
import { resolveTimeoutMs } from "../../core/workspace/config.ts";

export function registerRequest(program: Command): void {
  program
    .command("request <method> <url>")
    .description("Send an ad-hoc HTTP request")
    .option("--header <H>", `Request header "Name: Value" (repeatable)`, collect, [])
    .option("--body <json>", "Request body (JSON string)")
    .option("--timeout <ms>", "Request timeout (overrides apis/<name>/.env.yaml `timeoutMs` and zond.config.yml `defaults.timeout_ms`; default 30000)", parsePositiveInt("--timeout"))
    .option("--env <name>", "Environment for variable interpolation")
    .option("--api <name>", "Collection name; auto-loads env + Authorization from apis/<name>/.secrets.yaml")
    .option(
      "--json-path <path>",
      "Extract one field from the response body (dot notation, e.g. 'data.id', " +
      "'items[0].name'). Without --json, prints the value verbatim — scalars without " +
      "quotes for shell use (`id=$(zond request --json-path data.id ...)`), " +
      "objects/arrays as compact JSON. With --json, embeds the extracted value as " +
      "the envelope's `body` field.",
    )
    .option("--db <path>", "Path to SQLite database file")
    .option("--validate-schema", "TASK-142: validate the response body against the OpenAPI response schema (requires --api). Endpoint is auto-resolved from the request method + URL.path; templated paths like /users/{id} are matched via regex. Falls back gracefully if no endpoint matches — pass --validate-against to override.")
    .option("--validate-against <method:path>", "TASK-142: explicit endpoint override for --validate-schema, e.g. \"GET:/users/{id}\". Use the spec template form (with \"{...}\" placeholders).")
    .action(async (method: string, url: string, opts, cmd: Command) => {
      const headers = (opts.header as string[] | undefined)?.length ? (opts.header as string[]) : undefined;
      // ARV-53.
      const api = getApi(cmd, opts);
      let envTimeout: number | undefined;
      if (api) {
        try {
          envTimeout = (await loadEnvMeta(opts.env, `apis/${api}`)).timeoutMs;
        } catch { /* meta is best-effort */ }
      }
      const timeout = resolveTimeoutMs(opts.timeout, envTimeout);
      process.exitCode = await requestCommand({
        method,
        url,
        headers,
        body: opts.body,
        timeout,
        env: opts.env,
        api,
        jsonPath: opts.jsonPath,
        dbPath: opts.db,
        json: globalJson(cmd),
        validateSchema: opts.validateSchema === true || typeof opts.validateAgainst === "string",
        validateAgainst: opts.validateAgainst,
      });
    });
}
