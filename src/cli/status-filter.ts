/**
 * TASK-140: parse `--status` filter expressions for `zond db run/runs`.
 *
 * Accepted forms (combinable via comma):
 *   502                — exact code
 *   5xx / 4xx / 3xx / 2xx / 1xx — class wildcard (`5xx` ≡ 500..599)
 *   500-599            — inclusive range
 *   >=500 / >500 / <=400 / <400 — open-ended comparison
 *   500,502,504        — list of exacts
 *   5xx,429            — mix of class + exact
 *
 * The parser yields a `StatusMatcher` which the DB layer converts into a
 * single SQL `WHERE` fragment (set + ranges combined with `OR`).
 */

export interface StatusMatcher {
  /** Specific codes that should match. */
  exacts: number[];
  /** Inclusive ranges `[min, max]` — including class wildcards (5xx → 500..599). */
  ranges: Array<[number, number]>;
}

const CLASS_RE = /^([1-5])xx$/i;
const RANGE_RE = /^(\d{3})-(\d{3})$/;
const CMP_RE = /^(>=|<=|>|<)\s*(\d{3})$/;
const CODE_RE = /^\d{3}$/;

function pushExact(out: StatusMatcher, code: number): void {
  if (code < 100 || code > 599) {
    throw new Error(`status code out of range: ${code}`);
  }
  if (!out.exacts.includes(code)) out.exacts.push(code);
}

function pushRange(out: StatusMatcher, min: number, max: number): void {
  if (min > max) throw new Error(`status range start > end: ${min}-${max}`);
  out.ranges.push([min, max]);
}

/**
 * Parse a `--status` argument. Throws on invalid syntax — caller wraps the
 * thrown message in a CLI error.
 */
export function parseStatusFilter(raw: string): StatusMatcher {
  const trimmed = raw.trim();
  if (trimmed === "") throw new Error("empty --status value");
  const parts = trimmed.split(",").map((p) => p.trim()).filter((p) => p.length > 0);
  if (parts.length === 0) throw new Error("empty --status value");

  const out: StatusMatcher = { exacts: [], ranges: [] };
  for (const part of parts) {
    let m: RegExpMatchArray | null;
    if ((m = part.match(CODE_RE))) {
      pushExact(out, Number(part));
      continue;
    }
    if ((m = part.match(CLASS_RE))) {
      const klass = Number(m[1]);
      pushRange(out, klass * 100, klass * 100 + 99);
      continue;
    }
    if ((m = part.match(RANGE_RE))) {
      const lo = Number(m[1]);
      const hi = Number(m[2]);
      if (lo < 100 || lo > 599 || hi < 100 || hi > 599) {
        throw new Error(`status range out of bounds: ${part} (expected 100..599)`);
      }
      pushRange(out, lo, hi);
      continue;
    }
    if ((m = part.match(CMP_RE))) {
      const op = m[1]!;
      const code = Number(m[2]);
      if (code < 100 || code > 599) {
        throw new Error(`status comparison out of bounds: ${part} (expected 100..599)`);
      }
      switch (op) {
        case ">=": pushRange(out, code, 599); break;
        case ">":  pushRange(out, code + 1, 599); break;
        case "<=": pushRange(out, 100, code); break;
        case "<":  pushRange(out, 100, code - 1); break;
      }
      continue;
    }
    throw new Error(
      `invalid --status part: '${part}' (expected one of: 502, 5xx, 500-599, >=500, <400)`,
    );
  }
  return out;
}

/**
 * Compile a `StatusMatcher` to a SQL `WHERE` fragment + bound parameters.
 * The fragment is wrapped in parentheses; combine with other conditions via
 * `AND`. Returns `null` if the matcher is empty (no constraints).
 */
export function compileStatusFilterToSql(
  matcher: StatusMatcher,
  column: string,
): { sql: string; params: number[] } | null {
  const clauses: string[] = [];
  const params: number[] = [];
  if (matcher.exacts.length > 0) {
    const placeholders = matcher.exacts.map(() => "?").join(",");
    clauses.push(`${column} IN (${placeholders})`);
    params.push(...matcher.exacts);
  }
  for (const [lo, hi] of matcher.ranges) {
    clauses.push(`${column} BETWEEN ? AND ?`);
    params.push(lo, hi);
  }
  if (clauses.length === 0) return null;
  return { sql: `(${clauses.join(" OR ")})`, params };
}
