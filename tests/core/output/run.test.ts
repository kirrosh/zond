/**
 * ARV-116 (m-19): runCommandWithOutput — end-to-end producer →
 * render → write coverage. Stdout path is captured by monkey-patching
 * process.stdout.write; file path uses a temp dir.
 */
import { describe, test, expect } from "bun:test";
import { mkdtempSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import {
  runCommandWithOutput,
  type OutputSpec,
} from "../../../src/core/output/index.ts";

interface Payload { ok: boolean; n: number }

const RENDER_SPY: Array<{ format: string; payload: Payload }> = [];
const SPEC: OutputSpec<Payload> = {
  command: "test cmd",
  defaultFormat: "json",
  formats: {
    json:  { defaultChannel: "stdout", envelopeWrap: true },
    sarif: { defaultChannel: "file",   defaultFilename: "out.sarif" },
  },
  render: (format, payload) => {
    RENDER_SPY.push({ format, payload });
    return format === "sarif" ? `<sarif n=${payload.n}>` : JSON.stringify(payload);
  },
  exitCodePolicy: payload => (payload.ok ? 0 : 7),
};

function captureStdout(fn: () => Promise<unknown>): Promise<{ stdout: string; result: unknown }> {
  const orig = process.stdout.write.bind(process.stdout);
  const chunks: string[] = [];
  process.stdout.write = ((chunk: string | Uint8Array) => {
    chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
    return true;
  }) as typeof process.stdout.write;
  return fn()
    .then(result => ({ stdout: chunks.join(""), result }))
    .finally(() => { process.stdout.write = orig; });
}

describe("runCommandWithOutput — stdout path", () => {
  test("writes the rendered payload to stdout and trails with a newline", async () => {
    RENDER_SPY.length = 0;
    const { stdout, result } = await captureStdout(() =>
      runCommandWithOutput(SPEC, {}, async () => ({ ok: true, n: 1 })),
    );
    expect(stdout.trim()).toBe('{"ok":true,"n":1}');
    expect(stdout.endsWith("\n")).toBe(true);
    expect((result as { exitCode: number }).exitCode).toBe(0);
    expect(RENDER_SPY).toEqual([{ format: "json", payload: { ok: true, n: 1 } }]);
  });

  test("exitCodePolicy propagates non-zero exit codes", async () => {
    const { result } = await captureStdout(() =>
      runCommandWithOutput(SPEC, {}, async () => ({ ok: false, n: 0 })),
    );
    expect((result as { exitCode: number }).exitCode).toBe(7);
  });
});

describe("runCommandWithOutput — file path", () => {
  test("file-default format writes to defaultFilename inside the resolved cwd", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "zond-output-spec-"));
    const cwd = process.cwd();
    process.chdir(tmp);
    try {
      RENDER_SPY.length = 0;
      const result = await runCommandWithOutput(
        SPEC,
        { report: "sarif" },
        async () => ({ ok: true, n: 42 }),
      );
      const out = readFileSync(join(tmp, "out.sarif"), "utf8");
      expect(out).toBe("<sarif n=42>");
      expect(result.resolved.channel).toBe("file");
      expect(result.exitCode).toBe(0);
    } finally {
      process.chdir(cwd);
    }
  });

  test("--output redirects stdout-default formats to a file", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "zond-output-spec-"));
    const target = join(tmp, "envelope.json");
    RENDER_SPY.length = 0;
    const result = await runCommandWithOutput(
      SPEC,
      { output: target },
      async () => ({ ok: true, n: 99 }),
    );
    const out = readFileSync(target, "utf8");
    expect(out).toBe('{"ok":true,"n":99}');
    expect(result.resolved.channel).toBe("file");
    expect(result.resolved.format).toBe("json");
  });
});
