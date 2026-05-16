import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { generateJsonReport } from "../../src/core/reporter/json.ts";
import { generateJunitXml } from "../../src/core/reporter/junit.ts";
import { SecretRegistry, setSecretRegistry } from "../../src/core/secrets/registry.ts";
import type { TestRunResult } from "../../src/core/runner/types.ts";

const SECRET = "Bearer-token-abcd1234";

beforeEach(() => {
  const reg = new SecretRegistry();
  reg.register("auth_token", SECRET);
  setSecretRegistry(reg);
});

afterEach(() => {
  setSecretRegistry(new SecretRegistry());
});

function makeResults(): TestRunResult[] {
  return [{
    suite_name: "leaky",
    suite_file: "leaky.yaml",
    file: "leaky.yaml",
    started_at: new Date(0).toISOString(),
    finished_at: new Date(0).toISOString(),
    total: 1,
    passed: 0,
    failed: 1,
    skipped: 0,
    steps: [{
      name: "echo",
      status: "fail",
      duration_ms: 5,
      request: { method: "POST", url: `https://api/x?token=${SECRET}`, body: null },
      response: { status: 401, body: `oops ${SECRET}`, headers: {} },
      error: `unauthorized ${SECRET}`,
      assertions: [],
      captures: {},
      provenance: null,
      spec_pointer: null,
      spec_excerpt: null,
    } as any],
  } as any];
}

describe("reporter redaction (TASK-168)", () => {
  test("JSON reporter strips registered secret", () => {
    const out = generateJsonReport(makeResults());
    expect(out).not.toInclude(SECRET);
    expect(out).toInclude("<redacted:auth_token>");
  });

  test("JUnit reporter strips registered secret", () => {
    const out = generateJunitXml(makeResults());
    expect(out).not.toInclude(SECRET);
    expect(out).toInclude("<redacted:auth_token>");
  });

  test("disabled registry preserves raw values", () => {
    const reg = new SecretRegistry();
    reg.register("auth_token", SECRET);
    reg.setEnabled(false);
    setSecretRegistry(reg);
    expect(generateJsonReport(makeResults())).toInclude(SECRET);
    expect(generateJunitXml(makeResults())).toInclude(SECRET);
  });
});
