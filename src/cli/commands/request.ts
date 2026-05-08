import { sendAdHocRequest } from "../../core/runner/send-request.ts";
import { printError } from "../output.ts";
import { jsonOk, jsonError, printJson } from "../json-envelope.ts";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

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

    if (options.json) {
      printJson(jsonOk("request", result));
    } else {
      console.log(JSON.stringify(result, null, 2));
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
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (options.json) {
      printJson(jsonError("request", [message]));
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

import type { Command } from "commander";
import { globalJson } from "../resolve.ts";
import { collect, parsePositiveInt } from "../argv.ts";
import { readCurrentApi } from "../../core/context/current.ts";

export function registerRequest(program: Command): void {
  program
    .command("request <method> <url>")
    .description("Send an ad-hoc HTTP request")
    .option("--header <H>", `Request header "Name: Value" (repeatable)`, collect, [])
    .option("--body <json>", "Request body (JSON string)")
    .option("--timeout <ms>", "Request timeout", parsePositiveInt("--timeout"))
    .option("--env <name>", "Environment for variable interpolation")
    .option("--api <name>", "Collection name; auto-loads env + Authorization from apis/<name>/.secrets.yaml")
    .option("--json-path <path>", "Extract value from response (dot notation)")
    .option("--db <path>", "Path to SQLite database file")
    .action(async (method: string, url: string, opts, cmd: Command) => {
      const headers = (opts.header as string[] | undefined)?.length ? (opts.header as string[]) : undefined;
      const api = (opts.api as string | undefined) ?? readCurrentApi() ?? undefined;
      process.exitCode = await requestCommand({
        method,
        url,
        headers,
        body: opts.body,
        timeout: opts.timeout,
        env: opts.env,
        api,
        jsonPath: opts.jsonPath,
        dbPath: opts.db,
        json: globalJson(cmd),
      });
    });
}
