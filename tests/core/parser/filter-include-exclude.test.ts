/**
 * ARV-25: unit coverage for filterSuitesByOperationFilter — the suite-level
 * adapter over the unified --include/--exclude grammar that `zond run`
 * shares with `zond generate` and `zond checks run`.
 */
import { describe, test, expect } from "bun:test";

import { filterSuitesByOperationFilter } from "../../../src/core/parser/filter.ts";
import type { TestSuite, TestStep } from "../../../src/core/parser/types.ts";

function step(over: Partial<TestStep>): TestStep {
  return {
    name: over.name ?? "step",
    method: over.method ?? "GET",
    path: over.path ?? "/x",
    expect: over.expect ?? { status: 200 },
    source: over.source,
  };
}

function suite(name: string, tags: string[], steps: TestStep[]): TestSuite {
  return {
    name,
    tags,
    config: { timeout: 30_000, retries: 0, retry_delay: 0, follow_redirects: true, verify_ssl: true },
    tests: steps,
  };
}

const SUITES: TestSuite[] = [
  suite("emails", ["smoke", "positive"], [
    step({ name: "list emails", method: "GET", path: "/emails", source: { endpoint: "GET /emails" } }),
    step({ name: "create email", method: "POST", path: "/emails", source: { endpoint: "POST /emails" } }),
    step({ name: "get email", method: "GET", path: "/emails/{email_id}", source: { endpoint: "GET /emails/{email_id}" } }),
  ]),
  suite("contacts", ["smoke"], [
    step({ name: "list contacts", method: "GET", path: "/audiences/{audience_id}/contacts", source: { endpoint: "GET /audiences/{audience_id}/contacts" } }),
    step({ name: "create contact", method: "POST", path: "/audiences/{audience_id}/contacts", source: { endpoint: "POST /audiences/{audience_id}/contacts" } }),
  ]),
  suite("domains", ["positive"], [
    step({ name: "create domain", method: "POST", path: "/domains" }),
  ]),
];

describe("filterSuitesByOperationFilter", () => {
  test("no flags → returns input unchanged", () => {
    const r = filterSuitesByOperationFilter(SUITES, [], []);
    expect(r.suites).toBe(SUITES);
    expect(r.errors).toEqual([]);
  });

  test("path:/emails matches only top-level /emails steps", () => {
    const r = filterSuitesByOperationFilter(SUITES, ["path:^/emails$"], []);
    expect(r.errors).toEqual([]);
    expect(r.suites.map(s => s.name)).toEqual(["emails"]);
    expect(r.suites[0]!.tests.map(t => t.name)).toEqual(["list emails", "create email"]);
  });

  test("method:GET keeps only GET steps; suites without GET drop", () => {
    const r = filterSuitesByOperationFilter(SUITES, ["method:GET"], []);
    const names = r.suites.map(s => `${s.name}:[${s.tests.map(t => t.method).join(",")}]`);
    expect(names).toEqual(["emails:[GET,GET]", "contacts:[GET]"]);
  });

  test("tag:smoke keeps only suites tagged 'smoke'", () => {
    const r = filterSuitesByOperationFilter(SUITES, ["tag:smoke"], []);
    expect(r.suites.map(s => s.name).sort()).toEqual(["contacts", "emails"]);
  });

  test("multiple --include combine with OR (path OR method)", () => {
    const r = filterSuitesByOperationFilter(SUITES, ["path:^/domains$", "method:GET"], []);
    const names = r.suites.map(s => s.name).sort();
    expect(names).toEqual(["contacts", "domains", "emails"]);
    const emailSteps = r.suites.find(s => s.name === "emails")!.tests.map(t => t.name);
    expect(emailSteps).toEqual(["list emails", "get email"]);
  });

  test("--exclude evaluated after --include (POST removed from include set)", () => {
    const r = filterSuitesByOperationFilter(SUITES, ["tag:smoke"], ["method:POST"]);
    const names = r.suites.map(s => `${s.name}:[${s.tests.map(t => t.method).join(",")}]`);
    expect(names).toEqual(["emails:[GET,GET]", "contacts:[GET]"]);
  });

  test("operation-id matches against step.source.endpoint when present", () => {
    const r = filterSuitesByOperationFilter(SUITES, ["operation-id:^GET /emails$"], []);
    expect(r.suites.map(s => s.name)).toEqual(["emails"]);
    expect(r.suites[0]!.tests.map(t => t.name)).toEqual(["list emails"]);
  });

  test("malformed selector surfaces friendly error, no exception", () => {
    const r = filterSuitesByOperationFilter(SUITES, ["bogus-no-colon"], []);
    expect(r.suites).toEqual([]);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toContain('Filter "bogus-no-colon"');
  });

  test("invalid regex in path: surfaces friendly error", () => {
    const r = filterSuitesByOperationFilter(SUITES, ["path:["], []);
    expect(r.errors[0]).toMatch(/invalid regex/i);
  });

  test("filters that match nothing return empty list (caller decides messaging)", () => {
    const r = filterSuitesByOperationFilter(SUITES, ["tag:nope"], []);
    expect(r.suites).toEqual([]);
    expect(r.errors).toEqual([]);
  });
});
