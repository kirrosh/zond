import { test, expect } from "bun:test";
import { reportFixtureGaps } from "../../../src/core/workspace/fixture-gap-report.ts";
import type { TestSuite, TestStep } from "../../../src/core/parser/types.ts";

function step(partial: Partial<TestStep>): TestStep {
  return { name: "s", method: "GET", path: "/", expect: {}, ...partial } as TestStep;
}
function suite(name: string, tests: TestStep[]): TestSuite {
  return { name, tests, config: {} as TestSuite["config"] } as TestSuite;
}

test("undefined suite var with no producer is reported", () => {
  const suites = [suite("banks", [step({ path: "/x", json: { code: "{{bank_code}}" } })])];
  const r = reportFixtureGaps(suites, { base_url: "http://x" }, new Set());
  expect(r.undefinedVars.map(v => v.variable)).toEqual(["bank_code"]);
  expect(r.unseededRoots).toEqual([]);
});

test("var resolvable from env is NOT reported", () => {
  const suites = [suite("banks", [step({ path: "/{{bank_code}}" })])];
  const r = reportFixtureGaps(suites, { base_url: "x", bank_code: "042" }, new Set());
  expect(r.undefinedVars).toEqual([]);
});

test("required+empty, suite-referenced, step-unseeded var is an unseeded root", () => {
  const suites = [suite("persons", [step({ path: "/accounts/{{account}}/persons" })])];
  const r = reportFixtureGaps(suites, { base_url: "x", account: "" }, new Set(["account"]));
  expect(r.unseededRoots).toEqual([{ variable: "account" }]);
  // and it must NOT also appear as an undefinedVar (no double reporting)
  expect(r.undefinedVars.find(v => v.variable === "account")).toBeUndefined();
});

test("root created and used within the same suite is NOT flagged", () => {
  const suites = [
    suite("acct-crud", [
      step({ name: "create", path: "/accounts", method: "POST", expect: { body: { id: { capture: "account" } } } }),
      step({ path: "/accounts/{{account}}" }),
    ]),
  ];
  const r = reportFixtureGaps(suites, { base_url: "x", account: "" }, new Set(["account"]));
  expect(r.unseededRoots).toEqual([]);
  expect(r.undefinedVars).toEqual([]);
});

test("cross-suite root: created in one suite, referenced (uncaptured) in another → flagged", () => {
  const createSuite = suite("acct-crud", [
    step({ name: "create", path: "/accounts", method: "POST", expect: { body: { id: { capture: "account" } } } }),
  ]);
  const depSuite = suite("persons-crud", [step({ path: "/accounts/{{account}}/persons" })]);
  const r = reportFixtureGaps([createSuite, depSuite], { base_url: "x", account: "" }, new Set(["account"]));
  // regular-suite captures don't cross into persons-crud → account gates it
  expect(r.unseededRoots).toEqual([{ variable: "account" }]);
});

test("setup-suite capture crosses into regular suites → NOT flagged", () => {
  const setupSuite: TestSuite = {
    ...suite("bootstrap", [
      step({ name: "create", path: "/accounts", method: "POST", expect: { body: { id: { capture: "account" } } } }),
    ]),
    setup: true,
  };
  const depSuite = suite("persons-crud", [step({ path: "/accounts/{{account}}/persons" })]);
  const r = reportFixtureGaps([setupSuite, depSuite], { base_url: "x", account: "" }, new Set(["account"]));
  expect(r.unseededRoots).toEqual([]);
});

test("required+empty var no suite references is NOT reported (noise guard)", () => {
  const suites = [suite("s", [step({ path: "/unrelated" })])];
  const r = reportFixtureGaps(suites, { base_url: "x", unused_id: "" }, new Set(["unused_id"]));
  expect(r.unseededRoots).toEqual([]);
});

test("built-in $generators are never gaps", () => {
  const suites = [suite("s", [step({ json: { id: "{{$uuid}}", name: "{{$randomName}}" } })])];
  const r = reportFixtureGaps(suites, { base_url: "x" }, new Set());
  expect(r.undefinedVars).toEqual([]);
});
