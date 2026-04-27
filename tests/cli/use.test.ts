import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

import { useCommand } from "../../src/cli/commands/use.ts";

function suppressOutput() {
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  let captured = "";
  process.stdout.write = mock((data: any) => {
    captured += String(data);
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = mock(() => true) as typeof process.stderr.write;
  return {
    restore() {
      process.stdout.write = origOut;
      process.stderr.write = origErr;
    },
    get captured() {
      return captured;
    },
  };
}

describe("useCommand", () => {
  let cwd: string;
  let originalCwd: string;
  let output: ReturnType<typeof suppressOutput>;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "zond-use-"));
    originalCwd = process.cwd();
    process.chdir(cwd);
    output = suppressOutput();
  });
  afterEach(() => {
    output.restore();
    process.chdir(originalCwd);
    rmSync(cwd, { recursive: true, force: true });
  });

  test("zond use <api> writes .zond-current", async () => {
    const code = await useCommand({ api: "petstore" });
    expect(code).toBe(0);
    const path = join(cwd, ".zond-current");
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, "utf-8").trim()).toBe("petstore");
  });

  test("zond use --clear removes .zond-current", async () => {
    await useCommand({ api: "petstore" });
    const code = await useCommand({ clear: true });
    expect(code).toBe(0);
    expect(existsSync(join(cwd, ".zond-current"))).toBe(false);
  });

  test("zond use (no args) prints current value", async () => {
    await useCommand({ api: "petstore" });
    output.restore();
    output = suppressOutput();
    const code = await useCommand({});
    expect(code).toBe(0);
    expect(output.captured.trim()).toBe("petstore");
  });

  test("--json envelope reports action", async () => {
    const code = await useCommand({ api: "petstore", json: true });
    expect(code).toBe(0);
    const env = JSON.parse(output.captured);
    expect(env.ok).toBe(true);
    expect(env.command).toBe("use");
    expect(env.data.action).toBe("set");
    expect(env.data.api).toBe("petstore");
  });

  test("rejects empty api string", async () => {
    const code = await useCommand({ api: "   " });
    expect(code).toBe(1);
  });
});
