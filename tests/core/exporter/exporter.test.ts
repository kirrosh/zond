import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { type Exporter, runExporter, applySanitizer } from "../../../src/core/exporter/exporter.ts";
import { getSecretRegistry } from "../../../src/core/secrets/registry.ts";

beforeEach(() => {
  getSecretRegistry().clear();
  getSecretRegistry().setEnabled(true);
});

afterEach(() => {
  getSecretRegistry().clear();
  getSecretRegistry().setEnabled(true);
});

describe("TASK-186: Exporter pipeline", () => {
  test("runExporter applies sanitizer to render output", () => {
    getSecretRegistry().register("api_key", "topsecretvalue1234");
    const e: Exporter<string> = {
      name: "demo",
      mime: "text/plain",
      render: (s) => `payload: ${s}`,
    };
    const out = runExporter(e, "topsecretvalue1234");
    expect(out).not.toContain("topsecretvalue1234");
    expect(out).toContain("<redacted:api_key>");
  });

  test("applySanitizer is the same single pass used by the pipeline", () => {
    getSecretRegistry().register("token", "anothersecret9876");
    const out = applySanitizer("leak: anothersecret9876");
    expect(out).not.toContain("anothersecret9876");
    expect(out).toContain("<redacted:token>");
  });

  test("render() stays pure — no redaction without runExporter", () => {
    getSecretRegistry().register("auth", "rawsecretXXXXXXXX");
    const e: Exporter<string> = {
      name: "raw",
      mime: "text/plain",
      render: (s) => `value=${s}`,
    };
    // Direct render() bypasses sanitizer, by design — callers must use
    // runExporter at the boundary.
    const raw = e.render("rawsecretXXXXXXXX");
    expect(raw).toContain("rawsecretXXXXXXXX");
    // The pipeline closes the gap.
    expect(runExporter(e, "rawsecretXXXXXXXX")).not.toContain("rawsecretXXXXXXXX");
  });

  test("disabled registry leaves render output intact", () => {
    getSecretRegistry().register("api_key", "inertsecretvalue99");
    getSecretRegistry().setEnabled(false);
    const e: Exporter<string> = { name: "noop", mime: "text/plain", render: (s) => s };
    expect(runExporter(e, "inertsecretvalue99")).toBe("inertsecretvalue99");
  });
});
