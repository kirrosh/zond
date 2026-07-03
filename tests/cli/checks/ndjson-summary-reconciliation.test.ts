/**
 * ARV-322: the NDJSON summary must reconcile with the finding events in the
 * same stream. Findings removed retroactively by the broken-baseline guard
 * (ARV-307) have already been streamed as `type:finding` events, so they must
 * land in `summary.suppressed` — the invariant a stream consumer can rely on:
 *
 *   count(type == "finding") === summary.findings + summary.suppressed
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { mkdir, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";

import { runChecks } from "../../../src/core/checks/index.ts";
import type { NdjsonEvent } from "../../../src/core/checks/types.ts";

describe("ndjson summary reconciliation (ARV-322)", () => {
  let server: ReturnType<typeof Bun.serve>;
  let baseUrl: string;
  let tmpDir: string;
  let specPath: string;

  beforeAll(async () => {
    // Every op 401s → degenerate positive baseline → guard fires and strips
    // conformance findings from the summary after their events streamed.
    server = Bun.serve({
      port: 0,
      fetch() {
        return new Response("denied", { status: 401, headers: { "content-type": "text/plain" } });
      },
    });
    baseUrl = `http://localhost:${server.port}`;

    const paths: Record<string, unknown> = {};
    for (let i = 0; i < 12; i++) {
      paths[`/things${i}`] = { get: { responses: { "200": { description: "ok" } } } };
    }
    tmpDir = join(tmpdir(), `zond-arv322-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
    specPath = join(tmpDir, "spec.json");
    await writeFile(specPath, JSON.stringify({
      openapi: "3.0.0",
      info: { title: "demo", version: "1" },
      paths,
    }), "utf-8");
  });

  afterAll(async () => {
    server.stop(true);
    await rm(tmpDir, { recursive: true, force: true });
  });

  test("summary.findings + summary.suppressed === streamed finding events", async () => {
    const events: NdjsonEvent[] = [];
    const { data } = await runChecks({
      specPath,
      baseUrl,
      onEvent: (e) => events.push(e),
    });

    const streamed = events.filter((e) => e.type === "finding").length;
    const summaryEvent = events.filter((e) => e.type === "summary").at(-1);
    expect(summaryEvent).toBeDefined();

    // Guard must have fired (this is the ARV-322 scenario, not a healthy run).
    expect(data.spec_findings.some((sf) => sf.kind === "broken_baseline")).toBe(true);
    expect(data.summary.suppressed ?? 0).toBeGreaterThan(0);

    expect(data.summary.findings + (data.summary.suppressed ?? 0)).toBe(streamed);

    // by_severity must tally only the non-suppressed findings.
    const bySeverityTotal = Object.values(data.summary.by_severity).reduce((a, b) => a + b, 0);
    expect(bySeverityTotal).toBe(data.summary.findings);
  });
});
