/**
 * `${VAR}` / `${VAR:-default}` substitution for `.env.yaml` (TASK-169, m-10).
 *
 * Lets a workspace commit `.env.yaml` without bare secrets:
 *
 *     auth_token: "${MYAPI_AUTH_TOKEN}"
 *     base_url:   "${MYAPI_BASE_URL:-https://api.example.com}"
 *
 * Rules:
 *   - `${VAR}`           → process.env.VAR (throws if missing).
 *   - `${VAR:-default}`  → process.env.VAR ?? default. The default may
 *     contain `:` (everything after `:-` up to the closing `}` is the
 *     default).
 *   - `\${LITERAL}`      → literal `${LITERAL}` (the backslash is
 *     stripped). Matches the `dotenv-expand` / docker-compose convention.
 *   - One level of resolution only — values pulled from env are NOT
 *     re-scanned for further `${...}` (cycle-risk).
 *   - Variable names matching /TOKEN|SECRET|PASSWORD|KEY|DSN/i are NOT
 *     auto-registered with the redaction registry. Auto-registration is
 *     opt-in via `@secret:` (TASK-170). We do print a one-line warning
 *     suggesting the user mark them as a secret, but only the first time.
 */

const ENV_REF_RE = /(\\?)\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;
const SUSPICIOUS_NAME_RE = /TOKEN|SECRET|PASSWORD|API_KEY|^KEY$|_KEY$|DSN/i;

export interface EnvInterpolationContext {
  /** Absolute path of the file we're resolving — used for error messages. */
  filePath: string;
  /** YAML key whose value contains the reference — used for error messages. */
  key: string;
  /** Source of variables; defaults to `process.env`. Override in tests. */
  env?: Record<string, string | undefined>;
  /** Sink for human-facing warnings. Default: stderr write. */
  warn?: (msg: string) => void;
}

/** Module-level set of variable names we've already warned about, so the
 *  same `${MYAPI_AUTH_TOKEN}` reference doesn't yell once per env file. */
const warned = new Set<string>();

export function _resetEnvInterpolationWarnings(): void {
  warned.clear();
}

/**
 * Substitute every `${VAR}` / `${VAR:-default}` in `text`. Returns the
 * fully-resolved string. Throws `Error` when an unresolved reference has
 * no default.
 */
export function interpolateEnvRefs(text: string, ctx: EnvInterpolationContext): string {
  if (typeof text !== "string" || text.length === 0) return text;
  if (text.indexOf("${") === -1 && text.indexOf("\\$") === -1) return text;
  const env = ctx.env ?? (process.env as Record<string, string | undefined>);
  const warn = ctx.warn ?? ((m: string) => process.stderr.write(m + "\n"));

  return text.replace(ENV_REF_RE, (full, escape: string, name: string, def: string | undefined) => {
    if (escape === "\\") {
      // Escaped reference → strip the backslash, keep the literal.
      return full.slice(1);
    }
    const value = env[name];
    if (value === undefined || value === "") {
      if (def !== undefined) {
        return def;
      }
      throw new Error(
        `Environment variable \${${name}} is not set (referenced from "${ctx.filePath}", key "${ctx.key}"). ` +
        `Provide it via your shell, CI secret, or use the \${${name}:-<default>} form to give it a fallback.`,
      );
    }
    if (SUSPICIOUS_NAME_RE.test(name) && !warned.has(name)) {
      warned.add(name);
      warn(
        `[zond] ${ctx.filePath}: variable \${${name}} looks like a secret. ` +
        `Consider mapping it through @secret:${ctx.key} (TASK-170) so it is redacted in artifacts.`,
      );
    }
    return value;
  });
}

/**
 * Apply interpolation to every string value in a flat env object. Other
 * value types (numbers, booleans, nulls coming back from YAML) are
 * stringified untouched, matching the existing loader behaviour.
 */
export function interpolateEnvObject(
  obj: Record<string, unknown>,
  filePath: string,
  env?: Record<string, string | undefined>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string") {
      out[k] = interpolateEnvRefs(v, { filePath, key: k, env });
    } else {
      out[k] = String(v);
    }
  }
  return out;
}

const SUSPICIOUS_ENV_NAME_RE = SUSPICIOUS_NAME_RE;
