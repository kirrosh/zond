/**
 * `.secrets.yaml` — gitignored flat YAML file holding raw secret values
 * for an API (TASK-170, m-10). Companion to `.env.yaml` which references
 * keys here via `@secret:<name>`.
 *
 *     # apis/<name>/.secrets.yaml (NEVER committed)
 *     auth_token: "tok_..."
 *     dsn: "https://...@example.com/..."
 *
 *     # apis/<name>/.env.yaml (committable)
 *     auth_token: "@secret:auth_token"
 *     base_url: "https://api.example.com"
 *
 * Mental model: anything in `.secrets.yaml` is registered with the
 * `SecretRegistry` at load-time, so it gets redacted in any persisted
 * artifact (DB, exporters, digests). Anything in `.env.yaml` is plain.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getSecretRegistry } from "./registry.ts";

const SECRETS_FILENAME = ".secrets.yaml";
const SECRET_REF_RE = /^@secret:([A-Za-z_][A-Za-z0-9_.-]*)$/;

/** Resolved contents of a `.secrets.yaml`. */
export interface SecretsFile {
  filePath: string;
  values: Record<string, string>;
}

/**
 * Read `.secrets.yaml` from a directory, register every value with the
 * global SecretRegistry, and return the parsed map. Returns `null` when
 * the file is absent — callers should treat that as "no secrets to
 * register" rather than a failure.
 */
export function loadSecretsFile(dir: string): SecretsFile | null {
  const filePath = join(dir, SECRETS_FILENAME);
  if (!existsSync(filePath)) return null;
  const text = readFileSync(filePath, "utf-8");
  let parsed: unknown;
  try {
    parsed = (Bun as any).YAML.parse(text);
  } catch (err) {
    throw new Error(`Failed to parse ${filePath}: ${(err as Error).message}`);
  }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${filePath} must contain a flat YAML object of key: "value" entries`);
  }

  const values: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
    if (v == null) continue;                 // empty placeholder — skip
    if (typeof v === "object") {
      throw new Error(
        `${filePath}: nested values are not supported (key "${k}"). ` +
        `.secrets.yaml is intentionally flat — keep one level of key/value pairs.`,
      );
    }
    values[k] = String(v);
  }

  const reg = getSecretRegistry();
  reg.registerAll(values);

  return { filePath, values };
}

/**
 * Walk up a directory chain to find the first `.secrets.yaml` and load
 * it. Used by the env loader so a single secrets file at the API root
 * (`apis/<name>/.secrets.yaml`) is picked up regardless of which
 * subdirectory `zond run` was invoked from.
 */
export function loadSecretsFromAncestor(start: string, stopAt?: string): SecretsFile | null {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    const file = loadSecretsFile(dir);
    if (file) return file;
    if (stopAt && dir === stopAt) return null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

/**
 * Resolve any `@secret:<name>` reference inside an env object against
 * the values from `secrets`. Throws when a referenced name is missing
 * (fail-loud).
 */
export function resolveSecretRefs(
  envValues: Record<string, string>,
  secrets: SecretsFile | null,
  filePath: string,
): Record<string, string> {
  const out: Record<string, string> = { ...envValues };
  for (const [k, v] of Object.entries(out)) {
    const m = typeof v === "string" ? v.match(SECRET_REF_RE) : null;
    if (!m) continue;
    const refName = m[1]!;
    const value = secrets?.values[refName];
    if (value == null) {
      const where = secrets ? secrets.filePath : `${dirname(filePath)}/${SECRETS_FILENAME}`;
      throw new Error(
        `${filePath}: key "${k}" references @secret:${refName} but no such entry exists in ${where}. ` +
        `Add \`${refName}: "<value>"\` to ${where} (or remove the @secret: prefix to use a literal value).`,
      );
    }
    out[k] = value;
  }
  return out;
}
