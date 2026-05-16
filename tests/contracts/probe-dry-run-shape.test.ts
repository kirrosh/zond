/**
 * Dry-run output shape contract (m-17 / ARV-50 AC#1-#5).
 *
 * Validates that probe-class dry-run paths emit `data.endpoints[]`
 * with `planned`/`skip_reason` instead of leaking into the legacy
 * `severity.skipped` bucket. Reproduces F1-15: a security spec with
 * 14 attackable + 18 unattackable endpoints in dry-run must NOT
 * report severity at all.
 *
 * Schema validation runs against the published JSON Schema in
 * `docs/json-schema/probeDryRun.schema.json` so the doc and the
 * runtime stay locked.
 */
import { describe, test, expect } from "bun:test";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { OpenAPIV3 } from "openapi-types";

import { SecurityProbe } from "../../src/core/probe/security-probe-class.ts";
import { MassAssignmentProbe } from "../../src/core/probe/mass-assignment-probe-class.ts";
import { summarizeDryRun } from "../../src/core/probe/dry-run-envelope.ts";
import { ProbeDryRunDataSchema } from "../../src/cli/json-schemas.ts";
import { postEp } from "../_helpers/endpoints";

const ssrfSchema: OpenAPIV3.SchemaObject = {
  type: "object",
  required: ["url"],
  properties: {
    url: { type: "string", format: "uri" },
    title: { type: "string" },
  },
};

const noBodyEp = postEp({
  method: "POST",
  path: "/webhooks-no-body",
  requestBodySchema: undefined,
  requestBodyContentType: undefined,
});

const noMatchSchema: OpenAPIV3.SchemaObject = {
  type: "object",
  properties: { count: { type: "integer" } },
};

describe("probe security --dry-run shape", () => {
  test("returns endpoints[] with planned + skip_reason; no severity bucket", async () => {
    const probe = new SecurityProbe();
    const planned = postEp({ path: "/messages", requestBodySchema: ssrfSchema });
    const skippedNoBody = noBodyEp;
    const skippedNoMatch = postEp({ path: "/counters", requestBodySchema: noMatchSchema });

    const plan = await probe.dryRun({
      specPath: "fake.json",
      endpoints: [planned, skippedNoBody, skippedNoMatch],
      securitySchemes: [],
      vars: {},
      classes: ["ssrf"],
      options: {},
    });

    const data = summarizeDryRun(plan);

    // ARV-50 AC#1: per-endpoint shape with planned + skip_reason enum.
    expect(data.endpoints).toHaveLength(3);
    const byPath = new Map(data.endpoints.map((e) => [e.path, e]));
    const plannedEntry = byPath.get("/messages")!;
    expect(plannedEntry.planned).toBe(true);
    expect(plannedEntry.classes_planned).toContain("ssrf");
    expect(plannedEntry.fields_planned).toContain("url");
    expect(plannedEntry.skip_reason).toBeNull();

    const noBodyEntry = byPath.get("/webhooks-no-body")!;
    expect(noBodyEntry.planned).toBe(false);
    expect(noBodyEntry.skip_reason).toBe("no-body");

    const noMatchEntry = byPath.get("/counters")!;
    expect(noMatchEntry.planned).toBe(false);
    expect(noMatchEntry.skip_reason).toBe("no-matched-field");

    // ARV-50 AC#3: summary has explicit planned + skipped counters.
    expect(data.summary).toEqual({ totalEndpoints: 3, planned: 1, skipped: 2 });

    // ARV-50 AC#2: no `severity` field in dry-run data.
    expect((data as unknown as Record<string, unknown>)["severity"]).toBeUndefined();
  });

  test("matches the published probeDryRun schema (AC#5)", async () => {
    const probe = new SecurityProbe();
    const plan = await probe.dryRun({
      specPath: "fake.json",
      endpoints: [postEp({ path: "/m", requestBodySchema: ssrfSchema })],
      securitySchemes: [],
      vars: {},
      classes: ["ssrf"],
      options: {},
    });
    const data = summarizeDryRun(plan);
    const parsed = ProbeDryRunDataSchema.safeParse(data);
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true);
  });

  test("published JSON Schema file matches the zod source", () => {
    // Belt-and-suspenders: the emit-json-schemas script must keep
    // docs/json-schema/probeDryRun.schema.json in sync. If this fails,
    // run `bun run scripts/emit-json-schemas.ts`.
    const path = resolve(import.meta.dir, "..", "..", "docs", "json-schema", "probeDryRun.schema.json");
    const json = JSON.parse(readFileSync(path, "utf-8"));
    const fromZod = JSON.parse(JSON.stringify(z.toJSONSchema(ProbeDryRunDataSchema)));
    expect(json).toEqual(fromZod);
  });
});

describe("probe mass-assignment --dry-run shape", () => {
  test("returns endpoints[] with fields_planned for POST/PATCH", async () => {
    const probe = new MassAssignmentProbe();
    const post = postEp({ path: "/users", requestBodySchema: { type: "object", properties: { name: { type: "string" } } } });
    const get = postEp({ method: "GET", path: "/users", requestBodySchema: undefined });
    const noBody = postEp({ path: "/items-no-body", requestBodySchema: undefined, requestBodyContentType: undefined });

    const plan = await probe.dryRun({
      specPath: "fake.json",
      endpoints: [post, get, noBody],
      securitySchemes: [],
      vars: {},
      options: {},
    });
    const data = summarizeDryRun(plan);

    // GET filtered out at the source; only POST/PATCH/PUT remain.
    expect(data.endpoints.map((e) => `${e.method} ${e.path}`).sort()).toEqual([
      "POST /items-no-body",
      "POST /users",
    ]);
    const usersEntry = data.endpoints.find((e) => e.path === "/users")!;
    expect(usersEntry.planned).toBe(true);
    expect(usersEntry.fields_planned).toContain("is_admin");
    expect(usersEntry.fields_planned).toContain("role");
    expect(usersEntry.classes_planned).toEqual(["mass-assignment"]);

    const noBodyEntry = data.endpoints.find((e) => e.path === "/items-no-body")!;
    expect(noBodyEntry.planned).toBe(false);
    expect(noBodyEntry.skip_reason).toBe("no-body");
  });
});
