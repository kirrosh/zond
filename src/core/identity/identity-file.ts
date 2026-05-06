/**
 * `.identity.yaml` — gitignored flat YAML file holding non-secret-but-
 * personally-identifying values for an API (TASK-174, m-10).
 *
 *     # apis/sentry/.identity.yaml
 *     organization_id_or_slug: "acme-eng"
 *     member_id: "12345"
 *
 *     # apis/sentry/.env.yaml
 *     organization_id_or_slug: "@identity:organization_id_or_slug"
 *     auth_token: "@secret:auth_token"
 *
 * Mental model:
 *   - `.secrets.yaml` → values auto-registered with SecretRegistry,
 *     replaced with `<redacted:<name>>` in every persisted artifact.
 *   - `.identity.yaml` → values are visible locally and visible in
 *     case-study drafts by default. The opt-in `--redact-identity`
 *     flag (TASK-173) swaps them for placeholders when sharing
 *     outbound. Doctor shows them as plain text.
 *
 * The file is git-invisible (gitignore is amended by setup-api) so a
 * teammate forking the repo doesn't accidentally inherit your org slug.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const IDENTITY_FILENAME = ".identity.yaml";
export const IDENTITY_REF_RE = /^@identity:([A-Za-z_][A-Za-z0-9_.-]*)$/;

/** Canonical identity-key vocabulary. The setup-api seeder uses this to
 *  decide which placeholders to put in a fresh `.identity.yaml`. */
export const CANONICAL_IDENTITY_KEYS = new Set<string>([
  "organization_id_or_slug",
  "organization_slug",
  "organization_id",
  "member_id",
  "user_id",
  "project_id_or_slug",
  "project_slug",
  "project_id",
  "team_slug",
  "team_id",
  "account_id",
]);

export interface IdentityFile {
  filePath: string;
  values: Record<string, string>;
}

export function loadIdentityFile(dir: string): IdentityFile | null {
  const filePath = join(dir, IDENTITY_FILENAME);
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
    if (v == null) continue;
    if (typeof v === "object") {
      throw new Error(`${filePath}: nested values are not supported (key "${k}").`);
    }
    values[k] = String(v);
  }
  return { filePath, values };
}

export function loadIdentityFromAncestor(start: string, stopAt?: string): IdentityFile | null {
  let dir = start;
  for (let i = 0; i < 8; i++) {
    const file = loadIdentityFile(dir);
    if (file) return file;
    if (stopAt && dir === stopAt) return null;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
  return null;
}

/**
 * Replace every value from an identity map with `<identity:<key>>`
 * inside `text`. Used by `--redact-identity` (TASK-173). Mirrors the
 * SecretRegistry's logic — longest values first so a containing value
 * wins, minimum length 2 (identity slugs can be short like `acme`).
 */
export function redactIdentityIn(text: string, values: Record<string, string>): string {
  if (!text || Object.keys(values).length === 0) return text;
  const entries = Object.entries(values)
    .filter(([, v]) => typeof v === "string" && v.length >= 2)
    .sort((a, b) => b[1].length - a[1].length);
  let out = text;
  for (const [name, value] of entries) {
    if (out.indexOf(value) === -1) continue;
    out = out.split(value).join(`<identity:${name}>`);
  }
  return out;
}

export function resolveIdentityRefs(
  envValues: Record<string, string>,
  identity: IdentityFile | null,
  filePath: string,
): Record<string, string> {
  const out: Record<string, string> = { ...envValues };
  for (const [k, v] of Object.entries(out)) {
    const m = typeof v === "string" ? v.match(IDENTITY_REF_RE) : null;
    if (!m) continue;
    const refName = m[1]!;
    const value = identity?.values[refName];
    if (value == null) {
      const where = identity ? identity.filePath : `${dirname(filePath)}/${IDENTITY_FILENAME}`;
      throw new Error(
        `${filePath}: key "${k}" references @identity:${refName} but no such entry exists in ${where}. ` +
        `Add \`${refName}: "<value>"\` to ${where} (or remove the @identity: prefix to use a literal value).`,
      );
    }
    out[k] = value;
  }
  return out;
}
