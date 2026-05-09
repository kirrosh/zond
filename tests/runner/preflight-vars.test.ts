import { describe, test, expect } from "bun:test";
import { preflightCheckVars, formatMissingVarLine, summarizeMissingVars } from "../../src/core/runner/preflight-vars.ts";
import type { TestSuite } from "../../src/core/parser/types.ts";

function suite(partial: Partial<TestSuite>): TestSuite {
  return {
    name: "S",
    config: { timeout: 10000, retries: 0, retry_delay: 0, follow_redirects: false, verify_ssl: true },
    tests: [],
    ...partial,
  };
}

describe("preflightCheckVars", () => {
  test("flags undefined {{var}} not present in env", () => {
    const s = suite({
      tests: [
        { name: "T", method: "GET", path: "/x?n={{nonexistent_var}}", expect: {} },
      ],
    });
    const hits = preflightCheckVars([s], { base: "x" });
    expect(hits.map(h => h.variable)).toContain("nonexistent_var");
  });

  test("does not flag built-in $generators", () => {
    const s = suite({
      tests: [
        { name: "T", method: "POST", path: "/x", json: { id: "{{$uuid}}", ts: "{{$timestamp}}" }, expect: {} },
      ],
    });
    expect(preflightCheckVars([s], {})).toHaveLength(0);
  });

  test("recognises captures from any step in the suite as known", () => {
    const s = suite({
      tests: [
        {
          name: "create",
          method: "POST",
          path: "/u",
          expect: { body: { id: { capture: "user_id" } } },
        },
        {
          name: "get",
          method: "GET",
          path: "/u/{{user_id}}",
          expect: {},
        },
      ],
    });
    expect(preflightCheckVars([s], {})).toHaveLength(0);
  });

  test("recognises parameterize and set keys as known", () => {
    const s = suite({
      parameterize: { tier: ["a", "b"] },
      tests: [
        {
          name: "T",
          method: "GET",
          path: "/x/{{tier}}/{{computed}}",
          set: { computed: "value" },
          expect: {},
        },
      ],
    });
    expect(preflightCheckVars([s], {})).toHaveLength(0);
  });

  test("flags {{auth_token}} when env doesn't have it", () => {
    const s = suite({
      headers: { Authorization: "Bearer {{auth_token}}" },
      tests: [{ name: "T", method: "GET", path: "/x", expect: {} }],
    });
    const hits = preflightCheckVars([s], {});
    expect(hits.find(h => h.variable === "auth_token")).toBeDefined();
  });

  // ───────────────────────────── TASK-202: missed-branch coverage

  test("flags refs in step.json deep-nested object", () => {
    const s = suite({
      tests: [{
        name: "T",
        method: "POST",
        path: "/x",
        json: { user: { profile: { name: "{{deep_name}}", tags: ["{{deep_tag}}"] } } },
        expect: {},
      }],
    });
    const vars = preflightCheckVars([s], {}).map(h => h.variable);
    expect(vars).toContain("deep_name");
    expect(vars).toContain("deep_tag");
  });

  test("flags refs in step.form, step.multipart, step.headers, step.query, step.skip_if", () => {
    const s = suite({
      tests: [{
        name: "T",
        method: "POST",
        path: "/x",
        form: { f: "{{form_v}}" },
        multipart: { m: "{{mp_v}}" },
        headers: { "X-H": "{{hdr_v}}" },
        query: { q: "{{qry_v}}" },
        skip_if: "{{skip_v}} == 'yes'",
        expect: {},
      }],
    });
    const vars = preflightCheckVars([s], {}).map(h => h.variable).sort();
    expect(vars).toEqual(["form_v", "hdr_v", "mp_v", "qry_v", "skip_v"]);
  });

  test("flags refs in step.retry_until.condition and step.for_each.in", () => {
    const s = suite({
      tests: [{
        name: "T",
        method: "GET",
        path: "/x",
        retry_until: { condition: "{{wait_var}} == 1", max_attempts: 3, delay_ms: 0 },
        for_each: { var: "item", in: "{{list_var}}" },
        expect: {},
      }],
    });
    const vars = preflightCheckVars([s], {}).map(h => h.variable).sort();
    expect(vars).toContain("wait_var");
    expect(vars).toContain("list_var");
    // for_each.var introduces a new known variable inside the iteration —
    // it must NOT itself be flagged.
    expect(vars).not.toContain("item");
  });

  test("flags refs in suite.base_url and suite.headers", () => {
    const s = suite({
      base_url: "https://{{host}}/api",
      headers: { "X-Trace": "{{trace_id}}" },
      tests: [{ name: "T", method: "GET", path: "/x", expect: {} }],
    });
    const vars = preflightCheckVars([s], {}).map(h => h.variable).sort();
    expect(vars).toContain("host");
    expect(vars).toContain("trace_id");
  });

  test("captures inside expect.body.each / contains_item are added to known set", () => {
    const s = suite({
      tests: [
        {
          name: "list",
          method: "GET",
          path: "/items",
          expect: {
            body: {
              items: { each: { id: { capture: "first_id" } } },
              tags: { contains_item: { name: { capture: "tag_name" } } },
            },
          },
        },
        {
          name: "follow",
          method: "GET",
          path: "/items/{{first_id}}/{{tag_name}}",
          expect: {},
        },
      ],
    });
    expect(preflightCheckVars([s], {})).toHaveLength(0);
  });

  test("header-capture rule (expect.headers.X.capture) is recognised", () => {
    const s = suite({
      tests: [
        {
          name: "create",
          method: "POST",
          path: "/x",
          expect: { headers: { "X-Request-Id": { capture: "req_id" } } },
        },
        {
          name: "trace",
          method: "GET",
          path: "/r/{{req_id}}",
          expect: {},
        },
      ],
    });
    expect(preflightCheckVars([s], {})).toHaveLength(0);
  });

  test("for_each.var in step.path is OK; ref to its iteration variable doesn't get flagged", () => {
    const s = suite({
      parameterize: { ids: ["a", "b"] },
      tests: [{
        name: "T",
        method: "GET",
        path: "/x/{{id}}",
        for_each: { var: "id", in: "{{ids}}" },
        expect: {},
      }],
    });
    expect(preflightCheckVars([s], {})).toHaveLength(0);
  });

  test("for_each.in with {{undef}} is flagged", () => {
    const s = suite({
      tests: [{
        name: "T",
        method: "GET",
        path: "/x/{{id}}",
        for_each: { var: "id", in: "{{undef_list}}" },
        expect: {},
      }],
    });
    const vars = preflightCheckVars([s], {}).map(h => h.variable);
    expect(vars).toContain("undef_list");
  });

  test("formatMissingVarLine: with file + step", () => {
    const line = formatMissingVarLine({
      suite: "S",
      step: "T",
      file: "/p/x.yaml",
      variable: "v",
    });
    expect(line).toBe("Undefined variable {{v}} in S → T (/p/x.yaml)");
  });

  test("formatMissingVarLine: no file, no step (suite-level)", () => {
    const line = formatMissingVarLine({ suite: "S", variable: "v" });
    expect(line).toBe("Undefined variable {{v}} in S");
  });

  test("formatMissingVarLine: with file, no step", () => {
    const line = formatMissingVarLine({ suite: "S", file: "/p/x.yaml", variable: "v" });
    expect(line).toBe("Undefined variable {{v}} in S (/p/x.yaml)");
  });

  test("formatMissingVarLine: with step, no file", () => {
    const line = formatMissingVarLine({ suite: "S", step: "T", variable: "v" });
    expect(line).toBe("Undefined variable {{v}} in S → T");
  });

  test("summarizeMissingVars: empty input → empty output", () => {
    expect(summarizeMissingVars([])).toEqual([]);
  });

  test("summarizeMissingVars: dedupes by variable name and counts refs/suites", () => {
    const lines = summarizeMissingVars([
      { suite: "A", step: "t1", variable: "base_url" },
      { suite: "A", step: "t2", variable: "base_url" },
      { suite: "A", step: "t1", variable: "auth_token" },
      { suite: "B", step: "t1", variable: "auth_token" },
    ]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("{{auth_token}}");
    expect(lines[0]).toContain("{{base_url}}");
    expect(lines[0]).toContain("4 references across 2 suites");
  });

  test("summarizeMissingVars: caps head at 6 names with '… and N more'", () => {
    const hits = ["a", "b", "c", "d", "e", "f", "g", "h"].map((v) => ({
      suite: "S",
      variable: v,
    }));
    const lines = summarizeMissingVars(hits);
    expect(lines[0]).toContain("… and 2 more");
  });
});
