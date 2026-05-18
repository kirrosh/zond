/**
 * `#(funcName)` / `#(funcName(args))` dynamic-value substitution for
 * loaded YAML values (ARV-190, m-21).
 *
 * Lets a workspace avoid stale hardcoded data — UUIDs that get reused
 * by the API and pin existing rows, dates that expire days after
 * checkout, idempotency keys that race against past runs. Functions
 * are evaluated at LOAD time (per-run, not per-request), so a single
 * `#(uuid)` reference resolves to the same value across every step
 * inside one run — the idempotency-replay scenarios only work if the
 * key stays stable for the run's lifetime.
 *
 * Supported functions:
 *   #(uuid)              — fresh UUID v4 (stable within one run via cache)
 *   #(uuidStable(seed))  — deterministic UUID derived from seed (sha-256 → v4 shape)
 *   #(today)             — YYYY-MM-DD now (UTC)
 *   #(todayPlus(N))      — today + N days (N may be negative)
 *   #(now)               — ISO 8601 timestamp
 *   #(unix)              — seconds since epoch
 *   #(alphanumeric(N))   — N random a-z0-9 chars
 *   #(env:VAR)           — process.env.VAR (alias for ${VAR})
 *
 * Resolution order: env-interpolation (${VAR}) runs first because its
 * default-value syntax can produce strings the dynamic resolver should
 * see literally. Dynamic values run BEFORE @secret/@identity reference
 * resolution so the function tokens never leak into a secret-typed
 * value (and so secret-stored values that happen to look like `#(...)`
 * stay opaque). Strings that have no `#(` substring short-circuit.
 *
 * Nested forms: a single value may carry multiple references mixed
 * with literal text — `"req-#(uuid)-#(today)"` yields `req-<uuid>-2026-05-16`.
 */

import { createHash } from "node:crypto";

export interface DynamicValueContext {
  /** Per-run cache keyed by raw expression (`#(uuid)`, `#(today)`). */
  cache: Map<string, string>;
  /** Source of env vars; defaults to process.env. Override in tests. */
  env?: Record<string, string | undefined>;
  /** File path the value came from — surfaced in error messages. */
  filePath?: string;
}

/** Build a fresh cache for one resolution pass. Exported so the caller
 *  can share a cache across multiple `resolveDynamicValuesDeep` calls
 *  that belong to the same run (e.g. workspace + per-API env files). */
export function newDynamicCache(): Map<string, string> {
  return new Map();
}

// Captures `#(funcName)` or `#(funcName(args))`. `args` may contain any
// chars except an unescaped closing paren — keep it simple, the funcs we
// support take string or integer args without nested parens.
const FUNC_RE = /#\(([A-Za-z_][A-Za-z0-9_]*)(?::([^)]*))?(?:\(([^)]*)\))?\)/g;

export function resolveDynamicValues(
  text: string,
  ctx: DynamicValueContext,
): string {
  if (typeof text !== "string" || text.indexOf("#(") === -1) return text;
  return text.replace(FUNC_RE, (full, name: string, colonArg: string | undefined, parenArg: string | undefined) => {
    const cached = ctx.cache.get(full);
    if (cached !== undefined) return cached;
    const value = evaluate(name, colonArg ?? parenArg, full, ctx);
    ctx.cache.set(full, value);
    return value;
  });
}

export function resolveDynamicValuesDeep(
  obj: Record<string, unknown>,
  ctx: DynamicValueContext,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "string") {
      out[k] = resolveDynamicValues(v, ctx);
    } else {
      out[k] = String(v);
    }
  }
  return out;
}

function evaluate(
  name: string,
  arg: string | undefined,
  fullExpr: string,
  ctx: DynamicValueContext,
): string {
  switch (name) {
    case "uuid":
      return crypto.randomUUID();
    case "uuidStable": {
      if (!arg) throw makeError(`#(uuidStable(seed)) requires a seed argument`, fullExpr, ctx);
      return seedToUuid(arg);
    }
    case "today":
      return new Date().toISOString().slice(0, 10);
    case "todayPlus": {
      if (!arg) throw makeError(`#(todayPlus(N)) requires an integer N`, fullExpr, ctx);
      const n = Number.parseInt(arg, 10);
      if (!Number.isFinite(n)) throw makeError(`#(todayPlus(${arg})) — N must be an integer`, fullExpr, ctx);
      const d = new Date();
      d.setUTCDate(d.getUTCDate() + n);
      return d.toISOString().slice(0, 10);
    }
    case "now":
      return new Date().toISOString();
    case "unix":
      return String(Math.floor(Date.now() / 1000));
    case "alphanumeric": {
      const n = arg ? Number.parseInt(arg, 10) : 8;
      if (!Number.isFinite(n) || n <= 0 || n > 1024) {
        throw makeError(`#(alphanumeric(${arg ?? ""})) — length must be 1..1024`, fullExpr, ctx);
      }
      return randomAlphanumeric(n);
    }
    case "env": {
      if (!arg) throw makeError(`#(env:VAR) requires a variable name`, fullExpr, ctx);
      const env = ctx.env ?? (process.env as Record<string, string | undefined>);
      const v = env[arg];
      if (v === undefined || v === "") {
        throw makeError(`#(env:${arg}) is not set — define it in your shell or CI secret`, fullExpr, ctx);
      }
      return v;
    }
    default:
      throw makeError(`unknown dynamic function "${name}" in ${fullExpr} — supported: uuid, uuidStable, today, todayPlus, now, unix, alphanumeric, env`, fullExpr, ctx);
  }
}

function seedToUuid(seed: string): string {
  // SHA-256 the seed, take first 16 bytes, format as UUID v4 shape so
  // any consumer-side `format: uuid` validator accepts it. Variant +
  // version bits are forced to match v4 — the value is still
  // deterministic because the source bytes are stable per seed.
  const hash = createHash("sha256").update(seed).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;  // version 4
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;  // RFC 4122 variant
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

const ALPHANUM = "abcdefghijklmnopqrstuvwxyz0123456789";

function randomAlphanumeric(n: number): string {
  let out = "";
  for (let i = 0; i < n; i++) {
    out += ALPHANUM[Math.floor(Math.random() * ALPHANUM.length)];
  }
  return out;
}

function makeError(msg: string, expr: string, ctx: DynamicValueContext): Error {
  const where = ctx.filePath ? ` (referenced from ${ctx.filePath})` : "";
  return new Error(`Dynamic value ${expr}: ${msg}${where}`);
}
