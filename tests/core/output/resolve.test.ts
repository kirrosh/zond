/**
 * ARV-116 (m-19): policy matrix from src/core/output/README.md, in
 * executable form. Covers the six rules called out in the task AC
 * plus the OutputSpecError branches.
 */
import { describe, test, expect } from "bun:test";
import { resolve as resolvePath } from "path";

import {
  resolveOutput,
  OutputSpecError,
  type OutputSpec,
} from "../../../src/core/output/index.ts";

const SPEC: OutputSpec<unknown> = {
  command: "checks run",
  defaultFormat: "json",
  formats: {
    json:   { defaultChannel: "stdout", envelopeWrap: true },
    sarif:  { defaultChannel: "file",   defaultFilename: "zond-checks.sarif" },
    ndjson: { defaultChannel: "stdout" },
  },
  aliases: { ndjson: "ndjson" },
};

describe("resolveOutput — defaults & format-policy fanout", () => {
  test("rule #1: SARIF default → file with defaultFilename", () => {
    const r = resolveOutput(SPEC, { report: "sarif" });
    expect(r.format).toBe("sarif");
    expect(r.channel).toBe("file");
    expect(r.path).toBe(resolvePath("zond-checks.sarif"));
    expect(r.envelopeWrap).toBe(false);
  });

  test("rule #2: NDJSON default → stdout", () => {
    const r = resolveOutput(SPEC, { report: "ndjson" });
    expect(r.format).toBe("ndjson");
    expect(r.channel).toBe("stdout");
    expect(r.path).toBeUndefined();
  });

  test("rule #3: --output overrides channel, even for stdout-default formats", () => {
    const r = resolveOutput(SPEC, { report: "ndjson", output: "events.ndjson" });
    expect(r.channel).toBe("file");
    expect(r.path).toBe(resolvePath("events.ndjson"));
  });

  test("rule #3b: --output also overrides for file-default formats (no defaultFilename needed)", () => {
    const r = resolveOutput(SPEC, { report: "sarif", output: "custom.sarif" });
    expect(r.channel).toBe("file");
    expect(r.path).toBe(resolvePath("custom.sarif"));
  });
});

describe("resolveOutput — --json behaviour", () => {
  test("rule #4: --json + --report → OutputSpecError", () => {
    expect(() => resolveOutput(SPEC, { json: true, report: "sarif" })).toThrow(OutputSpecError);
  });

  test("rule #5: --json picks the first envelope-wrap format", () => {
    const r = resolveOutput(SPEC, { json: true });
    expect(r.format).toBe("json");
    expect(r.envelopeWrap).toBe(true);
    expect(r.channel).toBe("stdout");
  });

  test("bare invocation falls back to defaultFormat with its default channel", () => {
    const r = resolveOutput(SPEC, {});
    expect(r.format).toBe("json");
    expect(r.channel).toBe("stdout");
    expect(r.envelopeWrap).toBe(true);
  });
});

describe("resolveOutput — error branches", () => {
  test("rule #6: unknown --report format → OutputSpecError listing known formats", () => {
    let caught: unknown;
    try {
      resolveOutput(SPEC, { report: "yaml" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(OutputSpecError);
    expect((caught as Error).message).toContain('"yaml"');
    expect((caught as Error).message).toContain("json");
    expect((caught as Error).message).toContain("sarif");
  });

  test("alias resolves to its underlying format", () => {
    const aliased: OutputSpec<unknown> = {
      ...SPEC,
      aliases: { events: "ndjson" },
    };
    const r = resolveOutput(aliased, { report: "events" });
    expect(r.format).toBe("ndjson");
  });

  test("file-default format without defaultFilename and without --output → error", () => {
    const broken: OutputSpec<unknown> = {
      command: "broken",
      defaultFormat: "x",
      formats: { x: { defaultChannel: "file" } },
    };
    expect(() => resolveOutput(broken, { report: "x" })).toThrow(OutputSpecError);
  });
});
