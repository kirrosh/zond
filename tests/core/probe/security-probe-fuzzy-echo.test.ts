import { describe, it, expect } from "bun:test";
import { classifyEcho } from "../../../src/core/probe/security-probe.ts";

describe("classifyEcho — fuzzy CRLF echo classifier", () => {
  it("verbatim match still works", () => {
    const r = classifyEcho({ subject: "x\r\nY" }, "x\r\nY", "crlf");
    expect(r.matched).toBe(true);
    expect(r.kind).toBe("verbatim");
  });

  it("CR stripped: payload \\r\\nY echoed as \\nY → HIGH", () => {
    const r = classifyEcho({ subject: "ok\nY" }, "ok\r\nY", "crlf");
    expect(r.matched).toBe(true);
    expect(r.kind).toBe("CRLF→LF");
  });

  it("URL-decoded match: %0d%0a → \\r\\n echoed", () => {
    const r = classifyEcho({ subject: "x\r\nY" }, "x%0d%0aY", "crlf");
    expect(r.matched).toBe(true);
    expect(r.kind).toBe("url-decoded");
  });

  it("tail-only match: parser cut at newline, only suffix landed", () => {
    const r = classifyEcho({ subject: "Yzz" }, "prefix\r\nYzz", "crlf");
    expect(r.matched).toBe(true);
    expect(r.kind).toBe("tail after CRLF");
  });

  it("SSRF: only verbatim match (no fuzzy fallback)", () => {
    const r = classifyEcho({ url: "http://evil.tld" }, "http://evil.tld", "ssrf");
    expect(r.matched).toBe(true);
    expect(r.kind).toBe("verbatim");
  });

  it("SSRF: stripped variant does NOT match (CRLF heuristics off)", () => {
    const r = classifyEcho({ url: "http://evil" }, "http://evil%00", "ssrf");
    expect(r.matched).toBe(false);
  });

  it("open-redirect: verbatim only", () => {
    const r = classifyEcho({ next: "//evil.tld" }, "//evil.tld", "open-redirect");
    expect(r.matched).toBe(true);
    expect(r.kind).toBe("verbatim");
  });

  it("no echo: returns matched=false", () => {
    const r = classifyEcho({ subject: "clean output" }, "x\r\nY", "crlf");
    expect(r.matched).toBe(false);
  });
});
