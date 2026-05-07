import { describe, test, expect, mock, afterEach } from "bun:test";
import { VERSION } from "../../src/cli/version.ts";
import { captureOutput } from "../_helpers/output";

import { restoreFetch } from "../_helpers/fetch-mock";

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

afterEach(restoreFetch);

describe("update command", () => {
  test("non-compiled binary returns exit code 3 with install hint", async () => {
    // When running via bun test, isCompiledBinary() returns false
    const { updateCommand } = await import("../../src/cli/commands/update.ts");
    const { restore } = captureOutput();
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
    const { restore } = captureOutput();
    // check flag should still work — but since non-compiled, it returns "skip"
    const code = await updateCommand({ json: false, check: true });
    restore();
    expect(code).toBe(3);
  });

  test("up-to-date: GitHub returns same version → exit 0, action='none' in JSON", async () => {
    const { updateCommand } = await import("../../src/cli/commands/update.ts");
    mockGitHubRelease(`v${VERSION}`);
    let output = "";
    const origWrite = process.stdout.write;
    process.stdout.write = mock((chunk: string | Uint8Array) => {
      output += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      return true;
    }) as typeof process.stdout.write;
    const code = await updateCommand({ json: true, runtimeKind: "standalone" });
    process.stdout.write = origWrite;
    expect(code).toBe(0);
    const parsed = JSON.parse(output.trim());
    expect(parsed.ok).toBe(true);
    expect(parsed.data.action).toBe("none");
    expect(parsed.data.currentVersion).toBe(VERSION);
  });

  test("--check + outdated: action='available', no download attempted", async () => {
    const { updateCommand } = await import("../../src/cli/commands/update.ts");
    mockGitHubRelease("v999.0.0");
    let output = "";
    const origWrite = process.stdout.write;
    process.stdout.write = mock((chunk: string | Uint8Array) => {
      output += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      return true;
    }) as typeof process.stdout.write;
    const code = await updateCommand({ json: true, check: true, runtimeKind: "standalone" });
    process.stdout.write = origWrite;
    expect(code).toBe(0);
    const parsed = JSON.parse(output.trim());
    expect(parsed.data.action).toBe("available");
    expect(parsed.data.currentVersion).toBe(VERSION);
    expect(parsed.data.latestVersion).toBe("999.0.0");
  });

  test("network-failure: fetch throws → exit 2 with error envelope", async () => {
    const { updateCommand } = await import("../../src/cli/commands/update.ts");
    globalThis.fetch = mock(async () => { throw new Error("ENOTFOUND api.github.com"); }) as unknown as typeof fetch;
    let output = "";
    const origWrite = process.stdout.write;
    process.stdout.write = mock((chunk: string | Uint8Array) => {
      output += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      return true;
    }) as typeof process.stdout.write;
    const code = await updateCommand({ json: true, runtimeKind: "standalone" });
    process.stdout.write = origWrite;
    expect(code).toBe(2);
    const parsed = JSON.parse(output.trim());
    expect(parsed.ok).toBe(false);
    expect(JSON.stringify(parsed)).toContain("ENOTFOUND");
  });

  test("outdated → upgrade: asset missing for current platform yields exit 2", async () => {
    // The upgrade path runs through getTarget() → release.assets lookup. We
    // serve a release that *omits* the asset matching this platform so that
    // the file-replacing block is never reached, but the not-skip / not-check
    // branch is still exercised.
    const { updateCommand } = await import("../../src/cli/commands/update.ts");
    mockGitHubRelease("v999.0.0", [{ name: "zond-bogus-platform.tar.gz", browser_download_url: "http://example.invalid/x" }]);
    let output = "";
    const origWrite = process.stdout.write;
    process.stdout.write = mock((chunk: string | Uint8Array) => {
      output += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      return true;
    }) as typeof process.stdout.write;
    const code = await updateCommand({ json: true, runtimeKind: "standalone" });
    process.stdout.write = origWrite;
    // Either exit 2 (asset-not-found) on supported platforms or exit 2
    // (unsupported-platform) on others — both are expected non-success codes.
    expect(code).toBe(2);
    const parsed = JSON.parse(output.trim());
    expect(parsed.ok).toBe(false);
  });
});
