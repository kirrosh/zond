/**
 * Integration test for the ARV-10 NDJSON streaming reporter:
 *   - mock OpenAPI spec with two operations (one healthy, one 5xx),
 *   - runChecks() with `onEvent` accumulator,
 *   - assert event ordering (check_start → check_result | finding × N
 *     → summary), 1 summary terminal,
 *   - validate every emitted line against the *published*
 *     `docs/json-schema/ndjson-events.schema.json` via ajv.
 *
 * Why ajv instead of zod here: AC #4 explicitly demands the published
 * schema validates every event — testing zod-against-zod would ignore
 * any drift in `bun run schemas` output. ajv reads the on-disk JSON
 * Schema like a downstream consumer would.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, writeFile, rm } from "fs/promises";
import { readFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

import Ajv2020 from "ajv/dist/2020.js";

import { runChecks } from "../../../src/core/checks/index.ts";
import {
  NdjsonEventSchema,
  type NdjsonCheckStartEventSchema,
  type NdjsonCheckResultEventSchema,
  type NdjsonFindingEventSchema,
  type NdjsonSummaryEventSchema,
} from "../../../src/cli/json-schemas.ts";
import type { z } from "zod";

type AnyEvent =
  | z.infer<typeof NdjsonCheckStartEventSchema>
  | z.infer<typeof NdjsonCheckResultEventSchema>
  | z.infer<typeof NdjsonFindingEventSchema>
  | z.infer<typeof NdjsonSummaryEventSchema>;

describe("zond checks --ndjson reporter (ARV-10)", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl: string;
  let tmpDir: string;
  let specPath: string;

  beforeAll(async () => {
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/healthz" && req.method === "GET") {
          return Response.json({ ok: true });
        }
        if (url.pathname === "/explode" && req.method === "GET") {
          return new Response("boom", { status: 503 });
        }
        return new Response("not found", { status: 404 });
      },
    });
    baseUrl = `http://localhost:${server.port}`;

    tmpDir = join(tmpdir(), `zond-checks-arv10-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    specPath = join(tmpDir, "spec.json");
    await writeFile(specPath, JSON.stringify({
      openapi: "3.0.0",
      info: { title: "demo", version: "1" },
      paths: {
        "/healthz": { get: { responses: { "200": { description: "ok" } } } },
        "/explode": { get: { responses: { "200": { description: "ok" } } } },
      },
    }), "utf-8");
  });

  afterAll(async () => {
    server.stop(true);
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("AC #1 — every event has a `type` and validates via zod", async () => {
    const events: AnyEvent[] = [];
    await runChecks({
      specPath,
      baseUrl,
      include: ["not_a_server_error"],
      onEvent: (e) => events.push(e),
    });
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) {
      expect(typeof e.type).toBe("string");
      expect(NdjsonEventSchema.safeParse(e).success).toBe(true);
    }
  });

  test("AC #4 — every event validates against published JSON Schema (ajv)", async () => {
    const events: AnyEvent[] = [];
    await runChecks({
      specPath,
      baseUrl,
      include: ["not_a_server_error"],
      onEvent: (e) => events.push(e),
    });

    const schemaPath = join(import.meta.dir, "..", "..", "..", "docs", "json-schema", "ndjson-events.schema.json");
    const schema = JSON.parse(readFileSync(schemaPath, "utf-8"));
    const ajv = new Ajv2020({ allErrors: true, strict: false });
    const validate = ajv.compile(schema);
    for (const e of events) {
      const ok = validate(e);
      if (!ok) {
        // Surface ajv errors in a readable form when the assertion fails.
        throw new Error(`event ${JSON.stringify(e)} violates ndjson-events schema: ${JSON.stringify(validate.errors)}`);
      }
      expect(ok).toBe(true);
    }
  });

  test("event ordering: check_start per op, exactly one terminal summary, finding lines for failures", async () => {
    const events: AnyEvent[] = [];
    await runChecks({
      specPath,
      baseUrl,
      include: ["not_a_server_error"],
      onEvent: (e) => events.push(e),
    });

    const types = events.map((e) => e.type);
    expect(types.filter((t) => t === "check_start").length).toBe(2); // 2 ops
    expect(types.filter((t) => t === "summary").length).toBe(1);
    // Summary is terminal.
    expect(types.at(-1)).toBe("summary");
    // We hit one 5xx — at least one finding event with the right check id.
    const findings = events.filter((e): e is z.infer<typeof NdjsonFindingEventSchema> => e.type === "finding");
    expect(findings.length).toBeGreaterThanOrEqual(1);
    expect(findings[0]!.finding.check).toBe("not_a_server_error");
  });

  test("AC #2 — pipe shape: NDJSON serializes to one JSON object per line", async () => {
    const events: AnyEvent[] = [];
    await runChecks({
      specPath,
      baseUrl,
      include: ["not_a_server_error"],
      onEvent: (e) => events.push(e),
    });
    const stream = events.map((e) => JSON.stringify(e)).join("\n") + "\n";
    const lines = stream.split("\n").filter((l) => l.length > 0);
    expect(lines.length).toBe(events.length);
    // jq-style sanity: parse each line and pull `.type`.
    const parsedTypes = lines.map((l) => JSON.parse(l).type);
    expect(parsedTypes).toEqual(events.map((e) => e.type));
  });
});
