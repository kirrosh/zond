/**
 * ARV-277/278: tests for `getRecentFixturePosts(urlLikePattern, limit)` —
 * used by `zond api annotate dump --seed-bodies --with-last-attempt` to
 * surface the most recent fixture-kind POST attempt(s) against a
 * resource's create-endpoint URL.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { getDb, closeDb } from "../../src/db/schema.ts";
import { tmpDb, unlinkDb as tryUnlink } from "../_helpers/tmp-db";
import { createRun, saveResults } from "../../src/db/queries.ts";
import { getRecentFixturePosts, getRecentCreatePosts } from "../../src/db/queries/results.ts";
import type { LastFixtureAttempt } from "../../src/db/queries/results.ts";
import type { TestRunResult } from "../../src/core/runner/types.ts";

/** `getRecentFixturePosts(pattern, 1)[0]` — the single-most-recent-match
 *  shape the old `getLastFixturePost` convenience wrapper used to return. */
function lastFixturePost(urlLikePattern: string): LastFixtureAttempt | null {
  return getRecentFixturePosts(urlLikePattern, 1)[0] ?? null;
}

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

describe("fixture POST history (ARV-277/278)", () => {
  test("returns null when no fixture POSTs match the pattern", () => {
    const runId = createRun({ started_at: "2026-05-17T00:00:00.000Z", run_kind: "fixture" });
    saveResults(runId, [postStep("https://api.stripe.com/v1/customers", { status: 400 })]);
    expect(lastFixturePost("%/v1/topups%")).toBeNull();
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

    const got = lastFixturePost("%/v1/topups%");
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

    const got = lastFixturePost("%/v1/customers/%/sources%");
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
    expect(lastFixturePost("%/v1/topups%")).toBeNull();
  });

  test("getRecentFixturePosts returns last N in newest-first order (ARV-278)", () => {
    const runs = [
      { ts: "2026-05-17T08:00:00.000Z", body: "amount=100" },
      { ts: "2026-05-17T09:00:00.000Z", body: "amount=500" },
      { ts: "2026-05-17T10:00:00.000Z", body: "amount=1000" },
    ];
    for (const r of runs) {
      const id = createRun({ started_at: r.ts, run_kind: "fixture" });
      saveResults(id, [postStep("https://api.stripe.com/v1/topups", { status: 400, reqBody: r.body })]);
    }
    const recent = getRecentFixturePosts("%/v1/topups%", 2);
    expect(recent).toHaveLength(2);
    expect(recent[0]?.request_body).toBe("amount=1000");
    expect(recent[1]?.request_body).toBe("amount=500");
  });

  test("getRecentFixturePosts with limit 0 returns empty array", () => {
    const runId = createRun({ started_at: "2026-05-17T00:00:00.000Z", run_kind: "fixture" });
    saveResults(runId, [postStep("https://api.stripe.com/v1/topups", { status: 400 })]);
    expect(getRecentFixturePosts("%/v1/topups%", 0)).toEqual([]);
    expect(getRecentFixturePosts("%/v1/topups%", -1)).toEqual([]);
  });

  test("ARV-330: getRecentCreatePosts includes non-fixture run kinds", () => {
    // Root resource skip-no-created by prepare-fixtures (no fixture POST),
    // but a depth-check POSTed the create-path and captured the gate error.
    const checkRun = createRun({ started_at: "2026-07-03T00:00:00.000Z", run_kind: "check" });
    saveResults(checkRun, [postStep("https://api.stripe.com/v1/accounts", {
      status: 400, body: '{"error":{"message":"signed up for Connect"}}',
    })]);
    // fixture-only query is blind to it...
    expect(getRecentFixturePosts("%/v1/accounts%", 5)).toHaveLength(0);
    // ...the wider query surfaces it.
    const wide = getRecentCreatePosts("%/v1/accounts%", 5);
    expect(wide).toHaveLength(1);
    expect(wide[0]?.response_status).toBe(400);
    expect(wide[0]?.response_body).toContain("Connect");
  });

  test("ARV-330: getRecentCreatePosts is still POST-only", () => {
    const run = createRun({ started_at: "2026-07-03T00:00:00.000Z", run_kind: "probe" });
    saveResults(run, [postStep("https://api.stripe.com/v1/accounts", { status: 400 })]);
    // a GET to the same path must not count
    saveResults(run, [{
      suite_name: "probe", started_at: "2026-07-03T00:00:00.000Z", finished_at: "2026-07-03T00:00:01.000Z",
      total: 1, passed: 1, failed: 0, skipped: 0,
      steps: [{
        name: "GET", status: "pass", duration_ms: 10,
        request: { method: "GET", url: "https://api.stripe.com/v1/accounts", headers: {} },
        response: { status: 200, headers: {}, body: "{}", duration_ms: 10 },
        assertions: [], captures: {},
      }],
    }]);
    expect(getRecentCreatePosts("%/v1/accounts%", 5)).toHaveLength(1);
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
    expect(lastFixturePost("%/v1/topups%")).toBeNull();
  });
});
