import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  hasUnresolvedRequiredPathParam,
  executeWithResetRetry,
  runChecks,
} from "../../../src/core/checks/runner.ts";
import type { EndpointInfo } from "../../../src/core/generator/types.ts";
import type { HttpRequest, HttpResponse } from "../../../src/core/runner/types.ts";
import type { NdjsonEvent } from "../../../src/core/reporter/ndjson.ts";

const op = (params: unknown[]): EndpointInfo => ({ parameters: params } as unknown as EndpointInfo);
const req = { method: "POST", url: "http://x/y", headers: {} } as HttpRequest;
const ok = { status: 200, headers: {}, body: "{}", duration_ms: 1 } as unknown as HttpResponse;

describe("ARV-344: unresolved required path param", () => {
  const accountParam = { in: "path", name: "account", required: true };

  test("required path param absent from pathVars → true", () => {
    expect(hasUnresolvedRequiredPathParam(op([accountParam]), {})).toBe(true);
    expect(hasUnresolvedRequiredPathParam(op([accountParam]), { account: "" })).toBe(true);
  });

  test("required path param present in pathVars → false (seeded)", () => {
    expect(hasUnresolvedRequiredPathParam(op([accountParam]), { account: "acct_1" })).toBe(false);
  });

  test("optional path param unresolved → false (only guards required)", () => {
    expect(hasUnresolvedRequiredPathParam(op([{ in: "path", name: "cursor", required: false }]), {})).toBe(false);
  });
});

describe("ARV-353: transient reset retry", () => {
  test("retries past ECONNRESET then succeeds", async () => {
    let calls = 0;
    const exec = async () => {
      calls++;
      if (calls < 3) throw new Error("read ECONNRESET");
      return ok;
    };
    const r = await executeWithResetRetry(req, 100, 2, exec);
    expect(r.status).toBe(200);
    expect(calls).toBe(3);
  });

  test("a non-transient error (refused) is re-thrown at once, no retry", async () => {
    let calls = 0;
    const exec = async () => { calls++; throw new Error("ECONNREFUSED 127.0.0.1:1"); };
    await expect(executeWithResetRetry(req, 100, 2, exec)).rejects.toThrow(/ECONNREFUSED/);
    expect(calls).toBe(1);
  });

  test("exhausting retries on persistent reset re-throws", async () => {
    let calls = 0;
    const exec = async () => { calls++; throw new Error("socket hang up"); };
    await expect(executeWithResetRetry(req, 100, 2, exec)).rejects.toThrow(/socket hang up/);
    expect(calls).toBe(3); // 1 + 2 retries
  });
});

describe("ARV-351: check_result severity matches its finding", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl: string;
  let dir: string;
  let specPath: string;

  beforeAll(async () => {
    // Accept everything with 200 — a maxLength+1 boundary body slips through,
    // so negative_data_rejection fails with its DYNAMIC severity (medium for a
    // concrete schema breach), which differs from its declared default (low).
    server = Bun.serve({ port: 0, fetch: () => new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }) });
    baseUrl = `http://localhost:${server.port}`;
    dir = await mkdtemp(join(tmpdir(), "zond-351-"));
    specPath = join(dir, "spec.json");
    await writeFile(specPath, JSON.stringify({
      openapi: "3.0.0",
      info: { title: "t", version: "1" },
      paths: {
        "/things": {
          post: {
            operationId: "CreateThing",
            requestBody: {
              required: true,
              content: { "application/json": { schema: {
                type: "object",
                required: ["name"],
                properties: { name: { type: "string", maxLength: 5 } },
              } } },
            },
            responses: { "201": { description: "ok" } },
          },
        },
      },
    }), "utf-8");
  });

  afterAll(async () => {
    server.stop(true);
    await rm(dir, { recursive: true, force: true });
  });

  test("negative_data_rejection: fail check_result carries the finding's severity, not the declared default", async () => {
    const events: NdjsonEvent[] = [];
    await runChecks({
      specPath, baseUrl,
      include: ["negative_data_rejection"],
      phase: "coverage",
      onEvent: (e) => events.push(e),
    });

    const findings = events.filter((e) => e.type === "finding" && (e as { check?: string }).check === "negative_data_rejection");
    const failResults = events.filter(
      (e) => e.type === "check_result"
        && (e as { check?: string }).check === "negative_data_rejection"
        && (e as { verdict?: string }).verdict === "fail",
    );

    // Sanity: the dynamic-severity path actually fired.
    expect(findings.length).toBeGreaterThan(0);
    expect(failResults.length).toBeGreaterThan(0);

    const findingSev = new Set(findings.map((f) => (f as { finding: { severity: string } }).finding.severity));
    const resultSev = new Set(failResults.map((r) => (r as { severity: string }).severity));
    // One case → one severity value across record types (was high/low split).
    expect(findingSev).toEqual(resultSev);
    // And specifically the dynamic tier, not the declared "low".
    expect(resultSev.has("medium")).toBe(true);
  });
});
