import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  interpolateEnvObject,
  interpolateEnvRefs,
  _resetEnvInterpolationWarnings,
} from "../../../src/core/parser/env-interpolation.ts";

beforeEach(() => {
  _resetEnvInterpolationWarnings();
});

describe("interpolateEnvRefs (TASK-169)", () => {
  test("substitutes ${VAR} from process.env override", () => {
    expect(
      interpolateEnvRefs("Bearer ${TOK}", {
        filePath: "/x.yaml", key: "auth_token",
        env: { TOK: "abcd1234" },
      }),
    ).toBe("Bearer abcd1234");
  });

  test("uses default when ${VAR:-default} and var missing", () => {
    expect(
      interpolateEnvRefs("${BASE_URL:-https://example.com}", {
        filePath: "/x.yaml", key: "base_url", env: {},
      }),
    ).toBe("https://example.com");
  });

  test("treats empty string as missing and falls back to default", () => {
    expect(
      interpolateEnvRefs("${BASE_URL:-https://default}", {
        filePath: "/x.yaml", key: "base_url", env: { BASE_URL: "" },
      }),
    ).toBe("https://default");
  });

  test("unresolved ${VAR} without default throws with file/key context", () => {
    expect(() =>
      interpolateEnvRefs("${MISSING}", {
        filePath: "/abs/path/.env.yaml", key: "auth_token", env: {},
      }),
    ).toThrow(/MISSING.*\.env\.yaml.*auth_token/s);
  });

  test("escape \\${LITERAL} keeps the literal and strips the backslash", () => {
    expect(
      interpolateEnvRefs("price is \\${VAR}", {
        filePath: "/x.yaml", key: "note", env: {},
      }),
    ).toBe("price is ${VAR}");
  });

  test("warns once per suspicious name (TOKEN/SECRET/PASSWORD/...)", () => {
    const warnings: string[] = [];
    const ctx = {
      filePath: "/x.yaml", key: "auth_token",
      env: { SENTRY_TOKEN: "abcd1234efgh" },
      warn: (m: string) => warnings.push(m),
    };
    interpolateEnvRefs("${SENTRY_TOKEN}", ctx);
    interpolateEnvRefs("${SENTRY_TOKEN}", ctx); // dedup
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/looks like a secret/);
  });

  test("does not warn on non-suspicious name (BASE_URL)", () => {
    const warnings: string[] = [];
    interpolateEnvRefs("${BASE_URL}", {
      filePath: "/x.yaml", key: "base_url", env: { BASE_URL: "https://example.com" },
      warn: (m: string) => warnings.push(m),
    });
    expect(warnings).toHaveLength(0);
  });

  test("multiple substitutions in the same string", () => {
    expect(
      interpolateEnvRefs("${A}/${B:-fallback}/${A}", {
        filePath: "/x.yaml", key: "k", env: { A: "alpha" },
      }),
    ).toBe("alpha/fallback/alpha");
  });

  test("interpolateEnvObject coerces non-strings unchanged", () => {
    const out = interpolateEnvObject(
      { auth_token: "${T}", port: 8080, ratio: 0.5 },
      "/x.yaml",
      { T: "abcd1234" },
    );
    expect(out.auth_token).toBe("abcd1234");
    expect(out.port).toBe("8080");
    expect(out.ratio).toBe("0.5");
  });
});
