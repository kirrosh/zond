/**
 * Regression for ARV-319: `runChecks` crashed with "undefined is not an
 * object (evaluating 'r.path')" on a live Stripe run the moment a stateful
 * CRUD check produced pass/fail on a "list-only" CRUD group — a resource
 * with a GET list endpoint but no POST create and no GET-by-id read.
 *
 * These groups are real: `augmentWithListOnlyGroups` (runner.ts) adds them
 * whenever `buildApiResourceMap` finds a list path that some OTHER
 * endpoint's path-FK structurally points at, but no CRUD group claims (e.g.
 * `GET /widgets` + `GET /widgets/{widget_id}/logs`, no `POST /widgets`).
 * `pagination_invariants.applies(g)` only requires `g.list` — it doesn't
 * need create/read — so it's the realistic check that hits this shape.
 *
 * The crash: `group.create ?? group.read!` non-null-asserted a value that
 * was actually undefined on such a group. Unit tests for the check itself
 * (pagination-invariants.test.ts) call `.run(g, h)` directly and never
 * exercised the buggy line — it only lives in the runner's CRUD-loop
 * wrapper, so this has to be an end-to-end `runChecks()` test.
 */
import { describe, test, expect, afterAll } from "bun:test";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import "../../../src/core/checks/checks/index.ts";
import { runChecks } from "../../../src/core/checks/index.ts";
import type { NdjsonEvent } from "../../../src/core/reporter/ndjson.ts";

describe("ARV-319: list-only CRUD group does not crash the runner", () => {
  test("pagination_invariants runs to completion + emits check_result on a create/read-less group", async () => {
    const tmpDir = join(tmpdir(), `zond-arv319-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    const specPath = join(tmpDir, "spec.json");
    await writeFile(specPath, JSON.stringify({
      openapi: "3.0.0",
      info: { title: "t", version: "1" },
      paths: {
        // List-only: no POST /widgets, no GET /widgets/{id} — so
        // detectCrudGroups() produces zero group for "widgets".
        "/widgets": {
          get: {
            operationId: "list_widgets",
            parameters: [
              { name: "page", in: "query", schema: { type: "integer" } },
              { name: "per_page", in: "query", schema: { type: "integer" } },
            ],
            responses: { "200": { description: "ok" } },
          },
        },
        // Structurally points a path-FK at /widgets (resolveOwnerListPaths),
        // which is what makes buildApiResourceMap treat "widgets" as an
        // *implicit* (list-only) resource — the shape augmentWithListOnlyGroups
        // turns into a CrudGroup with `list` set and no `create`/`read`.
        "/widgets/{widget_id}/logs": {
          get: {
            operationId: "list_widget_logs",
            parameters: [{ name: "widget_id", in: "path", required: true, schema: { type: "string" } }],
            responses: { "200": { description: "ok" } },
          },
        },
      },
    }), "utf-8");

    const server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/widgets") {
          const page = url.searchParams.get("page");
          const body = page === "1"
            ? { data: [{ id: 1 }, { id: 2 }] }
            : { data: [{ id: 3 }, { id: 4 }] };
          return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
        }
        return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
      },
    });
    const baseUrl = `http://localhost:${server.port}`;

    const events: NdjsonEvent[] = [];
    let result;
    try {
      // Isolate to pagination_invariants — the only stateful CRUD check
      // whose applies() needs nothing but g.list.
      result = await runChecks({
        specPath,
        baseUrl,
        include: ["pagination_invariants"],
        onEvent: (ev) => events.push(ev),
      });
    } finally {
      server.stop(true);
      await rm(tmpDir, { recursive: true, force: true });
    }

    // The crash (ARV-319) threw synchronously out of runChecks before this
    // point was ever reached — reaching it at all is the primary assertion.
    expect(result).toBeDefined();
    expect(result.data.findings).toEqual([]);

    const checkResults = events.filter((e) => e.type === "check_result" && e.check === "pagination_invariants");
    expect(checkResults.length).toBe(1);
    const cr = checkResults[0] as Extract<NdjsonEvent, { type: "check_result" }>;
    expect(cr.verdict).toBe("pass");
    expect(cr.operation.path).toBe("/widgets");
    expect(cr.operation.method.toUpperCase()).toBe("GET");
  });
});
