/**
 * Unit tests for the `--mode positive|negative|all` filter (m-15 ARV-7).
 *
 * Acceptance:
 *   #2 — snapshot of which checks are active per mode (so adding a new
 *        check forces an explicit MODE_BY_CHECK entry).
 *   #3 — snapshot of generated case count per mode on a single op.
 */
import { describe, test, expect } from "bun:test";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  MODE_BY_CHECK,
  filterChecksByMode,
  caseMatchesMode,
  modeFor,
} from "../../../src/core/checks/mode.ts";
import { listChecks } from "../../../src/core/checks/registry.ts";
import { listStatefulChecks } from "../../../src/core/checks/stateful.ts";
import "../../../src/core/checks/checks/index.ts";
import { runChecks } from "../../../src/core/checks/index.ts";

describe("ARV-7 mode catalog", () => {
  test("MODE_BY_CHECK covers every registered check (no silent fall-through)", () => {
    const all = [...listChecks(), ...listStatefulChecks()];
    const missing = all.map((c) => c.id).filter((id) => !(id in MODE_BY_CHECK));
    expect(missing).toEqual([]);
  });

  test("AC#2 — active check sets per mode are stable", () => {
    const all = [...listChecks(), ...listStatefulChecks()];
    const idsForMode = (m: "positive" | "negative" | "all") =>
      filterChecksByMode(all, m).map((c) => c.id).sort();

    expect(idsForMode("positive")).toEqual([
      "content_type_conformance",
      "ensure_resource_availability",
      "not_a_server_error",
      "positive_data_acceptance",
      "response_headers_conformance",
      "response_schema_conformance",
      "status_code_conformance",
    ]);

    expect(idsForMode("negative")).toEqual([
      "content_type_conformance",
      "ensure_resource_availability",
      "ignored_auth",
      "missing_required_header",
      "negative_data_rejection",
      "not_a_server_error",
      "response_headers_conformance",
      "response_schema_conformance",
      "status_code_conformance",
      "unsupported_method",
      "use_after_free",
    ]);

    // mode=all: every registered check.
    expect(idsForMode("all")).toEqual(all.map((c) => c.id).sort());
  });

  test("modeFor / caseMatchesMode behave as advertised", () => {
    expect(modeFor("not_a_server_error")).toBe("all");
    expect(modeFor("negative_data_rejection")).toBe("negative");
    expect(modeFor("positive_data_acceptance")).toBe("positive");
    // Unknown id falls back to "all" — the runner adds new ids with no
    // mode annotation will *appear* in every mode (loud-by-default), but
    // the snapshot test above guards against landing there silently.
    expect(modeFor("unknown_id_xyz")).toBe("all");

    expect(caseMatchesMode("positive", "all")).toBe(true);
    expect(caseMatchesMode("positive", "negative")).toBe(false);
    expect(caseMatchesMode("negative", "negative")).toBe(true);
  });
});

describe("ARV-7 mode pipeline (AC#3)", () => {
  test("case-counts on one operation match the mode", async () => {
    const tmpDir = join(tmpdir(), `zond-arv7-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    const specPath = join(tmpDir, "spec.json");
    await writeFile(specPath, JSON.stringify({
      openapi: "3.0.0",
      info: { title: "t", version: "1" },
      paths: {
        "/widgets": {
          post: {
            parameters: [{ name: "X-Trace", in: "header", required: true, schema: { type: "string" } }],
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["name"],
                    properties: { name: { type: "string", minLength: 1 } },
                  },
                },
              },
            },
            responses: { "201": { description: "ok" } },
          },
        },
      },
    }), "utf-8");

    // Run against a sink server that 200s everything — we don't care
    // about findings here, only the case count the runner emits per
    // mode. `cases` is incremented exactly once per request sent.
    const server = Bun.serve({ port: 0, fetch: () => new Response(null, { status: 200 }) });
    const baseUrl = `http://localhost:${server.port}`;

    const all = await runChecks({ specPath, baseUrl, mode: "all" });
    const pos = await runChecks({ specPath, baseUrl, mode: "positive" });
    const neg = await runChecks({ specPath, baseUrl, mode: "negative" });

    server.stop(true);
    await rm(tmpDir, { recursive: true, force: true });

    // Single op /widgets POST has:
    //   1 positive case  + 1 missing-header negative + 1 negative-body
    //   + 6 unsupported-method (ARV-179: all missing methods from
    //     [GET, POST, PUT, PATCH, DELETE, OPTIONS, TRACE] minus POST)
    //   = 9 cases on `all`. Previously 4 — bumped after ARV-179 widened
    //   the method-complement enumeration.
    expect(all.data.summary.cases).toBe(9);
    // mode=positive: drops the 8 negative cases (1 + 1 + 6).
    expect(pos.data.summary.cases).toBe(1);
    // mode=negative: drops the 1 positive case.
    expect(neg.data.summary.cases).toBe(8);
  });
});
