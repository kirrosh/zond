/**
 * `zond secrets set <key> <value>` — write a raw secret into
 * `apis/<name>/.secrets.yaml` (ARV-377). Before this, rotating an expired
 * token meant hand-editing the gitignored file (or a python script), since
 * `zond fixtures add` only writes `.env.yaml` and the iron rules forbid an
 * agent reading `.secrets.yaml` directly.
 *
 * Two safety properties:
 *   • the value is NEVER echoed back (stdout, stderr, or JSON envelope) —
 *     only the key name and whether a Bearer prefix was stripped;
 *   • a `.secrets.yaml.bak` backup is written before the file is touched,
 *     mirroring `fixtures add --apply`.
 *
 * Bearer trap (ARV-367/AC3): `.secrets.yaml` holds the RAW token — zond's
 * runner adds the scheme prefix itself (`Authorization: Bearer <token>`).
 * A pasted `Bearer eyJ…` is therefore always a mistake, so we strip a
 * leading `Bearer ` (case-insensitive) and warn once. `--literal` keeps the
 * value verbatim for the rare case someone really means to store it.
 */
import type { Command } from "commander";
import { join } from "node:path";
import { copyFile } from "node:fs/promises";

import { getApi, MISSING_API_MESSAGE } from "../util/api-context.ts";
import { resolveApiCollection } from "../resolve.ts";
import { upsertEnvLine } from "./discover.ts";
import { jsonOk, jsonError, printJson } from "../json-envelope.ts";
import { printError, printSuccess } from "../output.ts";
import { globalJson } from "../resolve.ts";

interface SecretsSetOptions {
  api?: string;
  literal?: boolean;
  json?: boolean;
}

const BEARER_PREFIX_RE = /^\s*Bearer\s+/i;

/** Normalise a pasted secret value: strip a leading `Bearer ` prefix (unless
 *  `literal`) so `.secrets.yaml` holds the raw token zond's runner expects.
 *  Exported for unit tests. */
export function normalizeSecretValue(raw: string, literal?: boolean): { value: string; bearerStripped: boolean } {
  if (!literal && BEARER_PREFIX_RE.test(raw)) {
    return { value: raw.replace(BEARER_PREFIX_RE, ""), bearerStripped: true };
  }
  return { value: raw, bearerStripped: false };
}

/** Upsert one `key: "value"` line into `.secrets.yaml`, backing up first.
 *  Exported for unit tests. */
export async function applySecretWrite(
  secretsPath: string,
  key: string,
  value: string,
): Promise<{ backup: string | null }> {
  const file = Bun.file(secretsPath);
  const exists = await file.exists();
  let text = exists ? await file.text() : "";
  let backup: string | null = `${secretsPath}.bak`;
  if (exists) {
    try { await copyFile(secretsPath, backup); } catch { backup = null; }
  } else {
    backup = null;
  }
  text = upsertEnvLine(text, key, value);
  if (!text.endsWith("\n")) text += "\n";
  await Bun.write(secretsPath, text);
  return { backup };
}

async function setAction(key: string, valueParts: string[], cmd: Command): Promise<void> {
  const opts = cmd.opts<SecretsSetOptions>();
  const json = opts.json === true || globalJson(cmd);

  const fail = (m: string, code = 2) => {
    if (json) printJson(jsonError("secrets set", [m])); else printError(m);
    process.exit(code);
  };

  const apiName = getApi(cmd, { api: opts.api } as Record<string, unknown>);
  if (!apiName) return fail(MISSING_API_MESSAGE);
  const col = resolveApiCollection(apiName, undefined);
  if ("error" in col) return fail(col.error);
  if (!col.baseDir) return fail(`API '${apiName}' has no base_dir registered.`);

  const k = key.trim();
  if (!k) return fail("Secret key must not be empty. Usage: zond secrets set <key> <value>");

  // Join variadic value parts so an unquoted `Bearer eyJ…` paste (two argv
  // tokens) still lands as one value instead of dropping the token.
  const rawValue = valueParts.join(" ");
  const { value, bearerStripped } = normalizeSecretValue(rawValue, opts.literal);
  const warnings: string[] = [];
  if (bearerStripped) {
    warnings.push(
      "Stripped a leading 'Bearer ' prefix — .secrets.yaml stores the raw token; zond adds the scheme prefix itself. Pass --literal to keep it verbatim.",
    );
  }

  const secretsPath = join(col.baseDir, ".secrets.yaml");
  const { backup } = await applySecretWrite(secretsPath, k, value);

  // NEVER echo the value — key + metadata only.
  if (json) {
    printJson(jsonOk("secrets set", {
      api: apiName,
      secrets: secretsPath,
      key: k,
      bearer_stripped: bearerStripped,
      backup,
    }, warnings));
  } else {
    printSuccess(`Set secret '${k}' in ${secretsPath}` + (backup ? ` (backup: ${backup})` : ""));
    process.stdout.write("  (value not echoed)\n");
    for (const w of warnings) process.stderr.write(`Warning: ${w}\n`);
  }
  process.exit(0);
}

export function registerSecrets(program: Command): void {
  const secrets = program
    .command("secrets")
    .description("Manage apis/<name>/.secrets.yaml (gitignored raw secret values, TASK-170). Values are never echoed back.");

  secrets
    .command("set <key> <value...>")
    .description("Write a secret to .secrets.yaml (with .secrets.yaml.bak backup). Auto-strips a pasted 'Bearer ' prefix unless --literal. Never prints the value.")
    .option("--api <name>", "Registered API (apis/<name>/.secrets.yaml). Falls back to ZOND_API / .zond/current-api.")
    .option("--literal", "Store the value verbatim; do not strip a leading 'Bearer ' prefix.")
    .action(async (key: string, value: string[], _opts, cmd: Command) => {
      await setAction(key, value, cmd);
    });
}
