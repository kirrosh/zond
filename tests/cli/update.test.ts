import { describe, test, expect, mock, afterEach } from "bun:test";
import { VERSION } from "../../src/cli/index.ts";

const originalFetch = globalThis.fetch;

function suppressOutput() {
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  process.stdout.write = mock(() => true) as typeof process.stdout.write;
  process.stderr.write = mock(() => true) as typeof process.stderr.write;
  return () => {
    process.stdout.write = origOut;
    process.stderr.write = origErr;
  };
}

function mockGitHubRelease(tagName: string, assets: { name: string; browser_download_url: string }[] = []) {
  globalThis.fetch = mock(async () => {
    return new Response(JSON.stringify({
      tag_name: tagName,
      assets,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("update command", () => {
  test("non-compiled binary returns exit code 3 with install hint", async () => {
    // When running via bun test, isCompiledBinary() returns false
    const { updateCommand } = await import("../../src/cli/commands/update.ts");
    const restore = suppressOutput();
    const code = await updateCommand({ json: false });
    restore();
    expect(code).toBe(3);
  });

  test("non-compiled binary returns skip in JSON mode with installHint", async () => {
    const { updateCommand } = await import("../../src/cli/commands/update.ts");
    let output = "";
    const origWrite = process.stdout.write;
    process.stdout.write = mock((chunk: string | Uint8Array) => {
      output += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      return true;
    }) as typeof process.stdout.write;

    const code = await updateCommand({ json: true });

    process.stdout.write = origWrite;
    expect(code).toBe(3);
    const parsed = JSON.parse(output.trim());
    expect(parsed.ok).toBe(true);
    expect(parsed.data.action).toBe("skip");
    expect(parsed.data.reason).toBe("not-standalone");
    expect(parsed.data.installHint).toContain("install.sh");
  });

  test("check flag returns exit code 3 for non-compiled", async () => {
    const { updateCommand } = await import("../../src/cli/commands/update.ts");
    const restore = suppressOutput();
    // check flag should still work — but since non-compiled, it returns "skip"
    const code = await updateCommand({ json: false, check: true });
    restore();
    expect(code).toBe(3);
  });
});
