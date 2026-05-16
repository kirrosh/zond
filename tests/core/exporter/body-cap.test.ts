import { describe, expect, test } from "bun:test";
import { capBody } from "../../../src/core/exporter/html-report/index.ts";
import { renderCaseStudy } from "../../../src/core/exporter/case-study/index.ts";

describe("capBody (TASK-164)", () => {
  test("returns content unchanged when cap is undefined / 0", () => {
    expect(capBody("hello", undefined)).toBe("hello");
    expect(capBody("hello", 0)).toBe("hello");
  });

  test("truncates with marker when content exceeds cap", () => {
    const big = "x".repeat(20_000);
    const out = capBody(big, 4096)!;
    expect(out.length).toBeLessThan(20_000);
    expect(out).toMatch(/\[truncated \d+ bytes; first 4096 shown/);
    expect(out.startsWith("x".repeat(4096))).toBe(true);
  });

  test("leaves null/empty bodies alone", () => {
    expect(capBody(null, 100)).toBe(null);
    expect(capBody("", 100)).toBe("");
  });
});

describe("renderCaseStudy honours bodyCapBytes", () => {
  test("truncates response_body in markdown when cap set", () => {
    const big = JSON.stringify({ data: "x".repeat(20_000) });
    const md = renderCaseStudy({
      result: {
        id: 1,
        run_id: 1,
        suite_name: "s",
        test_name: "t",
        status: "fail",
        duration_ms: 0,
        request_method: "GET",
        request_url: "https://api.example.com/x",
        request_body: null,
        response_status: 500,
        response_body: big,
        response_headers: null,
        error_message: null,
        assertions: [],
        captures: {},
        suite_file: null,
        provenance: null,
        failure_class: null,
        failure_class_reason: null,
        spec_pointer: null,
        spec_excerpt: null,
      } as any,
      run: { id: 1, started_at: new Date().toISOString() } as any,
      zondVersion: "test",
      bodyCapBytes: 1024,
    });
    expect(md).toMatch(/\[truncated \d+ bytes; first 1024 shown/);
    expect(md).not.toInclude("x".repeat(20_000));
  });
});
