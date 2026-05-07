import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

import { useCommand } from "../../src/cli/commands/use.ts";
import { captureOutput } from "../_helpers/output";
import { makeWorkspace } from "../_helpers/workspace";

describe("useCommand", () => {
  let cwd: string;
  let cleanupWs: () => void;
  let output: ReturnType<typeof captureOutput>;

  beforeEach(() => {
    const ws = makeWorkspace({ prefix: "zond-use-", chdir: true });
    cwd = ws.path;
    cleanupWs = ws.cleanup;
    output = captureOutput();
  });
  afterEach(() => {
    output.restore();
    cleanupWs();
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
    output = captureOutput();
    const code = await useCommand({});
    expect(code).toBe(0);
    expect(output.out.trim()).toBe("petstore");
  });

  test("--json envelope reports action", async () => {
    const code = await useCommand({ api: "petstore", json: true });
    expect(code).toBe(0);
    const env = JSON.parse(output.out);
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
