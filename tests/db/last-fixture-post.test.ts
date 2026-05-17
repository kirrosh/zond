/**
 * ARV-277: tests for `getLastFixturePost(urlLikePattern)` — used by
 * `zond api annotate dump --seed-bodies --with-last-attempt` to surface
 * the most recent fixture-kind POST attempt against a resource's
 * create-endpoint URL.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { getDb, closeDb } from "../../src/db/schema.ts";
import { tmpDb, unlinkDb as tryUnlink } from "../_helpers/tmp-db";
import { createRun, saveResults } from "../../src/db/queries.ts";
import { getLastFixturePost } from "../../src/db/queries/results.ts";
import type { TestRunResult } from "../../src/core/runner/types.ts";

let dbPath: string;

beforeEach(() => {
  dbPath = tmpDb();
  getDb(dbPath);
});

afterEach(() => {
  closeDb();
  tryUnlink(dbPath);
});

function postStep(url: string, opts: { status: number; body?: string; reqBody?: string }): TestRunResult {
  return {
    suite_name: "fixture/cascade",
    started_at: "2026-05-17T00:00:00.000Z",
    finished_at: "2026-05-17T00:00:01.000Z",
    total: 1,
    passed: opts.status >= 200 && opts.status < 300 ? 1 : 0,
    failed: opts.status >= 400 ? 1 : 0,
    skipped: 0,
    steps: [
      {
        name: `cascade::POST ${url}`,
        status: opts.status >= 200 && opts.status < 300 ? "pass" : "fail",
        duration_ms: 50,
        request: { method: "POST", url, headers: {}, body: opts.reqBody },
        response: { status: opts.status, headers: {}, body: opts.body ?? "", duration_ms: 50 },
        assertions: [],
        captures: {},
      },
    ],
  };
}

describe("getLastFixturePost (ARV-277)", () => {
  test("returns null when no fixture POSTs match the pattern", () => {
    const runId = createRun({ started_at: "2026-05-17T00:00:00.000Z", run_kind: "fixture" });
    saveResults(runId, [postStep("https://api.stripe.com/v1/customers", { status: 400 })]);
    expect(getLastFixturePost("%/v1/topups%")).toBeNull();
  });

  test("returns the most recent fixture POST when several runs match", () => {
    const oldRun = createRun({ started_at: "2026-05-17T10:00:00.000Z", run_kind: "fixture" });
    saveResults(oldRun, [postStep("https://api.stripe.com/v1/topups", {
      status: 400, body: '{"error":"old"}', reqBody: "amount=100&currency=usd",
    })]);
    const newRun = createRun({ started_at: "2026-05-17T11:00:00.000Z", run_kind: "fixture" });
    saveResults(newRun, [postStep("https://api.stripe.com/v1/topups", {
      status: 400, body: '{"error":"new"}', reqBody: "amount=1000&currency=usd",
    })]);

    const got = getLastFixturePost("%/v1/topups%");
    expect(got).not.toBeNull();
    expect(got?.response_status).toBe(400);
    expect(got?.response_body).toBe('{"error":"new"}');
    expect(got?.request_body).toBe("amount=1000&currency=usd");
    expect(got?.attempted_at).toBe("2026-05-17T11:00:00.000Z");
  });

  test("matches path-param patterns via SQL LIKE", () => {
    const runId = createRun({ started_at: "2026-05-17T00:00:00.000Z", run_kind: "fixture" });
    saveResults(runId, [postStep("https://api.stripe.com/v1/customers/cus_abc/sources", {
      status: 400, body: '{"error":"missing source"}', reqBody: "",
    })]);

    const got = getLastFixturePost("%/v1/customers/%/sources%");
    expect(got).not.toBeNull();
    expect(got?.request_url).toContain("cus_abc");
    expect(got?.response_body).toContain("missing source");
  });

  test("ignores non-fixture runs (run_kind = 'regular')", () => {
    // A `zond run` produced this POST; we don't want to surface it as a
    // seed-fixture attempt because it isn't one.
    const regularRun = createRun({ started_at: "2026-05-17T00:00:00.000Z", run_kind: "regular" });
    saveResults(regularRun, [postStep("https://api.stripe.com/v1/topups", {
      status: 200, body: '{"id":"tu_ok"}',
    })]);
    expect(getLastFixturePost("%/v1/topups%")).toBeNull();
  });

  test("ignores GET requests (only POSTs count as seed attempts)", () => {
    const runId = createRun({ started_at: "2026-05-17T00:00:00.000Z", run_kind: "fixture" });
    // Simulate the cascade list-call (GET) that prepare-fixtures issues.
    const step: TestRunResult = {
      suite_name: "fixture/cascade",
      started_at: "2026-05-17T00:00:00.000Z",
      finished_at: "2026-05-17T00:00:01.000Z",
      total: 1, passed: 1, failed: 0, skipped: 0,
      steps: [
        {
          name: "cascade::GET https://api.stripe.com/v1/topups",
          status: "pass",
          duration_ms: 30,
          request: { method: "GET", url: "https://api.stripe.com/v1/topups", headers: {} },
          response: { status: 200, headers: {}, body: '{"data":[]}', duration_ms: 30 },
          assertions: [],
          captures: {},
        },
      ],
    };
    saveResults(runId, [step]);
    expect(getLastFixturePost("%/v1/topups%")).toBeNull();
  });
});
