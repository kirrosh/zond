import { sendAdHocRequest } from "../../core/runner/send-request.ts";
import { printError, printSuccess, printWarning } from "../output.ts";
import { jsonOk, jsonError, printJson, zerr } from "../json-envelope.ts";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { createSchemaValidator } from "../../core/runner/schema-validator.ts";
import { readOpenApiSpec, extractEndpoints } from "../../core/generator/openapi-reader.ts";
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

/** ARV-110 / ARV-144: pretty-print --json-path failure to stderr.
 *  Two distinct hints depending on the failure:
 *  - top-level array (reason starts with "expected an array index"):
 *    user wrote `data[0].id` against a body that's already an array →
 *    suggest `[0].id` / `0.id`.
 *  - envelope confusion (firstSeg in body/data, resolved is empty):
 *    user came from `--json | jq .data.body.id` and forgot that --json-path
 *    addresses the response body, not the envelope. */
function printJsonPathDiagnostic(
  jsonPath: string | undefined,
  diag: { resolved: string[]; failedAt?: string; reason?: string } | undefined,
): void {
  if (!jsonPath || !diag?.failedAt) return;
  const resolved = diag.resolved.length > 0 ? diag.resolved.join(".") : "(root)";
  process.stderr.write(
    `zond: --json-path '${jsonPath}' did not resolve — stopped at segment "${diag.failedAt}" after ${resolved}: ${diag.reason ?? "unknown"}\n`,
  );
  const firstSeg = jsonPath.replace(/\[\d+\]/g, "").split(".")[0];
  const isArrayMismatch = diag.resolved.length === 0 && /^expected an array index/.test(diag.reason ?? "");
  if (isArrayMismatch) {
    const tail = jsonPath.replace(/^[^.[]+/, "");
    const suggestion = tail ? `[0]${tail.startsWith(".") || tail.startsWith("[") ? tail : "." + tail}` : "[0]";
    process.stderr.write(
      `      Hint: response body is a top-level array — use \`--json-path '${suggestion}'\` or \`--json-path '0${tail}'\` to index it.\n`,
    );
    return;
  }
  if ((firstSeg === "body" || firstSeg === "data") && diag.resolved.length === 0) {
    process.stderr.write(
      `      Hint: --json-path extracts from the response body, not the zond envelope. ` +
      `To address the envelope's data.body.id, use \`--json\` and pipe to jq.\n`,
    );
  }
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
  /** ARV-149: send the body as `application/x-www-form-urlencoded` (Stripe v1
   *  style). When omitted but `--api` is set, zond auto-detects from the
   *  spec's requestBody.content. */
  form?: boolean;
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

    // ARV-149: when --form is not set but --api is, peek at the spec to see
    // whether the matching endpoint declares only application/x-www-form-urlencoded
    // (Stripe v1 pattern). If so, default to form encoding so users don't get
    // a 400 "wrong content type" on every POST against form-only APIs.
    let useForm = options.form === true;
    if (!useForm && options.api) {
      useForm = await detectFormFromSpec(options).catch(() => false);
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
      form: useForm,
    });

    // ARV-265 (B3): persist this ad-hoc call into runs/results when a
    // session is active, so `zond coverage --scope audit` attributes it.
    // No session → no DB write (mirrors `curl`-replacement intent).
    await maybePersistAuditedRequest({
      options,
      method: options.method.toUpperCase(),
      url: options.url,
      headers,
      body: options.body,
      result,
    }).catch((err) => {
      process.stderr.write(`zond: audit persistence failed (${(err as Error).message}).\n`);
    });

    let validation: SchemaValidationOutcome | null = null;
    if (options.validateSchema || options.validateAgainst) {
      validation = await runSchemaValidation(options, result);
    }

    if (options.json) {
      printJson(jsonOk("request", validation ? { ...result, schema_validation: validation } : result));
      // ARV-110: surface jsonPath diagnostic on stderr in --json mode too, so
      // pipelines that read envelope from stdout still see *why* `body` came
      // back null. Without this, the only signal was a silent null inside the
      // envelope — easy to misread as "envelope shape differs between modes".
      printJsonPathDiagnostic(options.jsonPath, result.jsonPathDiagnostic);
    } else if (options.jsonPath) {
      // TASK-133: pipe-friendly mode — print only the extracted value.
      // Scalars (string/number/bool) emit verbatim with no JSON quoting so
      // shells can use the output directly (e.g. `id=$(zond request … --json-path data.id)`).
      // null/undefined → empty line. Objects/arrays → compact JSON.
      const v = result.body;
      if (v === null || v === undefined) {
        console.log("");
        printJsonPathDiagnostic(options.jsonPath, result.jsonPathDiagnostic);
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
// ARV-265 (B3): persist an ad-hoc `zond request` call into runs/results
// so `zond coverage --scope audit` sees the HTTP touch. Only fires when
// a session is active — outside a session, the command stays a pure
// curl-replacement and the DB doesn't grow with one-off requests.
// ──────────────────────────────────────────────

async function maybePersistAuditedRequest(args: {
  options: RequestOptions;
  method: string;
  url: string;
  headers: Record<string, string>;
  body: string | undefined;
  result: { status: number; headers: Record<string, string>; body: unknown; duration_ms: number };
}): Promise<void> {
  const { readCurrentSession } = await import("../../core/context/session.ts");
  const session = readCurrentSession();
  if (!session) return; // B3: outside-session calls leave no trace.

  const { checksPersistEnabled, beginAuditRun, finalizeAuditRun } =
    await import("../../core/audit/persist.ts");
  if (!checksPersistEnabled()) return;

  getDb(args.options.dbPath);
  const collectionId = args.options.api ? findCollectionByNameOrId(args.options.api)?.id : undefined;
  const runId = beginAuditRun({
    runKind: "request",
    ...(collectionId != null ? { collectionId } : {}),
    sessionId: session.id,
    tags: ["request", "ad-hoc"],
  });
  const status = args.result.status >= 200 && args.result.status < 400 ? "pass" : "fail";
  finalizeAuditRun(runId, [
    {
      suiteName: "request/ad-hoc",
      suiteFile: `apis/${args.options.api ?? "_"}/request.yaml`,
      testName: `request::${args.method} ${args.url}`,
      status,
      request: { method: args.method, url: args.url, headers: args.headers, body: args.body },
      response: {
        status: args.result.status,
        headers: args.result.headers,
        body: typeof args.result.body === "string" ? args.result.body : JSON.stringify(args.result.body ?? ""),
        duration_ms: args.result.duration_ms,
      },
      durationMs: args.result.duration_ms,
    },
  ]);
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

/** ARV-149: peek at the OpenAPI spec for the matching endpoint and return
 *  true when its requestBody declares only application/x-www-form-urlencoded
 *  (no JSON variant). Cheap-failing — any spec/db error returns false so the
 *  caller falls back to the JSON default. */
async function detectFormFromSpec(options: RequestOptions): Promise<boolean> {
  if (!options.api || !options.body) return false;
  getDb(options.dbPath);
  const col = findCollectionByNameOrId(options.api);
  if (!col?.openapi_spec) return false;
  const doc = await readOpenApiSpec(resolveCollectionSpec(col.openapi_spec));
  const endpoints = extractEndpoints(doc);
  const method = options.method.toUpperCase();
  const path = extractPath(options.url);
  // The OpenAPI reader normalises requestBodyContentType (prefers JSON when
  // present, otherwise records the first declared content type). For a true
  // form-only endpoint that field is "application/x-www-form-urlencoded".
  const exact = endpoints.find(e => e.method.toUpperCase() === method && e.path === path);
  const matched = exact ?? endpoints.find(e => {
    if (e.method.toUpperCase() !== method) return false;
    const re = new RegExp(
      "^" + e.path.replace(/\{[^}]+\}/g, "[^/]+").replace(/\//g, "\\/") + "$",
    );
    return re.test(path);
  });
  return matched?.requestBodyContentType === "application/x-www-form-urlencoded";
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
      "Extract one field from the RESPONSE BODY (not the zond envelope; " +
      "to address envelope.data.body.id pipe `--json` through jq instead). " +
      "Dot notation, e.g. 'data.id', 'items[0].name'. For top-level array " +
      "responses use '[0].id' or '0.id'. Without --json, prints " +
      "the value verbatim — scalars without quotes for shell use " +
      "(`id=$(zond request --json-path data.id ...)`), objects/arrays as compact JSON. " +
      "With --json, embeds the extracted value as the envelope's `body` field.",
    )
    .option("--db <path>", "Path to SQLite database file")
    .option("--validate-schema", "TASK-142: validate the response body against the OpenAPI response schema (requires --api). Endpoint is auto-resolved from the request method + URL.path; templated paths like /users/{id} are matched via regex. Falls back gracefully if no endpoint matches — pass --validate-against to override.")
    .option("--validate-against <method:path>", "TASK-142: explicit endpoint override for --validate-schema, e.g. \"GET:/users/{id}\". Use the spec template form (with \"{...}\" placeholders).")
    .option("--form", "ARV-149: send --body as application/x-www-form-urlencoded (Stripe v1, Rails/PHP-style APIs). Parses --body as JSON to lift fields, re-encodes with bracket notation. Auto-detected when --api is set and the spec endpoint declares only the form content type.")
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
        form: opts.form === true,
      });
    });
}
