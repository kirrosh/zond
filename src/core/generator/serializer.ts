import { resolve } from "path";

// ──────────────────────────────────────────────
// Utility functions (moved from skeleton.ts)
// ──────────────────────────────────────────────

export function isRelativeUrl(url: string): boolean {
  return url.startsWith("/") && !url.includes("://");
}

export function resolveSpecPath(specPath: string): string {
  if (specPath.startsWith("http://") || specPath.startsWith("https://")) {
    return specPath;
  }
  return resolve(specPath);
}

export function sanitizeEnvName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30);
}

// ──────────────────────────────────────────────
// Types for raw suite serialization
// ──────────────────────────────────────────────

export interface RawStep {
  name: string;
  [methodKey: string]: unknown;
  expect: {
    status?: number;
    body?: Record<string, Record<string, string>>;
    headers?: Record<string, unknown>;
  };
}

export interface RawSuite {
  name: string;
  setup?: boolean;
  tags?: string[];
  folder?: string;
  fileStem?: string;
  base_url?: string;
  headers?: Record<string, string>;
  tests: RawStep[];
}

// ──────────────────────────────────────────────
// YAML serializer
// ──────────────────────────────────────────────

export function serializeSuite(suite: RawSuite): string {
  const lines: string[] = [];
  lines.push(`name: ${yamlScalar(suite.name)}`);
  if (suite.setup) {
    lines.push("setup: true");
  }
  if (suite.tags && suite.tags.length > 0) {
    lines.push(`tags: [${suite.tags.join(", ")}]`);
  }
  if (suite.base_url) {
    lines.push(`base_url: ${yamlScalar(suite.base_url)}`);
  }
  if (suite.headers && Object.keys(suite.headers).length > 0) {
    lines.push("headers:");
    for (const [hk, hv] of Object.entries(suite.headers)) {
      lines.push(`  ${hk}: ${yamlScalar(String(hv))}`);
    }
  }
  lines.push("tests:");

  for (const test of suite.tests) {
    lines.push(`  - name: ${yamlScalar(test.name)}`);

    // Write method-as-key (the shorthand)
    for (const method of ["GET", "POST", "PUT", "PATCH", "DELETE"]) {
      if (method in test) {
        lines.push(`    ${method}: ${test[method]}`);
      }
    }

    // headers
    if (test.headers && Object.keys(test.headers as Record<string, string>).length > 0) {
      lines.push("    headers:");
      for (const [hk, hv] of Object.entries(test.headers as Record<string, string>)) {
        lines.push(`      ${hk}: ${yamlScalar(String(hv))}`);
      }
    }

    // json body
    if (test.json !== undefined) {
      lines.push("    json:");
      serializeValue(test.json, 3, lines);
    }

    // query
    if (test.query) {
      lines.push("    query:");
      serializeValue(test.query, 3, lines);
    }

    // skip_if
    if (test.skip_if) {
      lines.push(`    skip_if: ${yamlScalar(String(test.skip_if))}`);
    }

    // retry_until
    if (test.retry_until && typeof test.retry_until === "object") {
      const rt = test.retry_until as Record<string, unknown>;
      lines.push("    retry_until:");
      if (rt.condition !== undefined) lines.push(`      condition: ${yamlScalar(String(rt.condition))}`);
      if (rt.max_attempts !== undefined) lines.push(`      max_attempts: ${rt.max_attempts}`);
      if (rt.delay_ms !== undefined) lines.push(`      delay_ms: ${rt.delay_ms}`);
    }

    // for_each
    if (test.for_each && typeof test.for_each === "object") {
      const fe = test.for_each as Record<string, unknown>;
      lines.push("    for_each:");
      if (fe.var !== undefined) lines.push(`      var: ${yamlScalar(String(fe.var))}`);
      if (fe.in !== undefined) lines.push(`      in: ${yamlScalar(String(fe.in))}`);
    }

    // set
    if (test.set && typeof test.set === "object") {
      lines.push("    set:");
      serializeValue(test.set, 3, lines);
    }

    // expect
    const hasExpect = test.expect && (test.expect.status !== undefined || test.expect.body);
    if (hasExpect) {
      lines.push("    expect:");
      if (test.expect.status !== undefined) {
        lines.push(`      status: ${test.expect.status}`);
      }
      if (test.expect.body) {
        lines.push("      body:");
        for (const [key, rule] of Object.entries(test.expect.body)) {
          lines.push(`        ${key}:`);
          for (const [rk, rv] of Object.entries(rule)) {
            if (typeof rv === "object" && rv !== null) {
              lines.push(`          ${rk}:`);
              serializeValue(rv, 6, lines);
            } else {
              lines.push(`          ${rk}: ${yamlScalar(String(rv))}`);
            }
          }
        }
      }
    }
  }

  return lines.join("\n") + "\n";
}

function serializeValue(value: unknown, indent: number, lines: string[]): void {
  const prefix = "  ".repeat(indent);

  if (value === null || value === undefined) {
    lines.push(`${prefix}null`);
    return;
  }

  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    lines.push(`${prefix}${yamlScalar(String(value))}`);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "object" && item !== null && !Array.isArray(item)) {
        const entries = Object.entries(item as Record<string, unknown>);
        if (entries.length > 0) {
          const [firstKey, firstVal] = entries[0]!;
          if (typeof firstVal === "object" && firstVal !== null) {
            lines.push(`${prefix}- ${firstKey}:`);
            serializeValue(firstVal, indent + 1, lines);
          } else {
            lines.push(`${prefix}- ${firstKey}: ${formatInlineValue(firstVal)}`);
          }
          for (let i = 1; i < entries.length; i++) {
            const [k, v] = entries[i]!;
            if (typeof v === "object" && v !== null) {
              lines.push(`${prefix}  ${k}:`);
              serializeValue(v, indent + 1, lines);
            } else {
              lines.push(`${prefix}  ${k}: ${formatInlineValue(v)}`);
            }
          }
        } else {
          lines.push(`${prefix}- {}`);
        }
      } else {
        lines.push(`${prefix}- ${formatInlineValue(item)}`);
      }
    }
    return;
  }

  if (typeof value === "object") {
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      if (typeof val === "object" && val !== null) {
        lines.push(`${prefix}${key}:`);
        serializeValue(val, indent + 1, lines);
      } else {
        lines.push(`${prefix}${key}: ${formatInlineValue(val)}`);
      }
    }
  }
}

function formatInlineValue(val: unknown): string {
  if (val === null || val === undefined) return "null";
  if (typeof val === "string") return yamlScalar(val);
  return String(val);
}

function yamlScalar(value: string): string {
  if (
    value === "" ||
    value === "true" ||
    value === "false" ||
    value === "null" ||
    value.includes(":") ||
    value.includes("#") ||
    value.includes("\n") ||
    value.includes("'") ||
    value.includes('"') ||
    value.includes("{") ||
    value.includes("}") ||
    value.includes("[") ||
    value.includes("]") ||
    value.startsWith("&") ||
    value.startsWith("*") ||
    value.startsWith("!") ||
    value.startsWith("%") ||
    value.startsWith("@") ||
    value.startsWith("`") ||
    /^\d+$/.test(value)
  ) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return value;
}
