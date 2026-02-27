import { describe, expect, test } from "bun:test";
import { detectTarget, parseVersion, compareVersions } from "../../src/cli/commands/update.ts";

describe("update command", () => {
  test("detectTarget returns valid target for current platform", () => {
    const { target, archive } = detectTarget();
    expect(target).toMatch(/^(linux|darwin|win)-(x64|arm64)$/);
    expect(["tar.gz", "zip"]).toContain(archive);

    if (process.platform === "win32") {
      expect(archive).toBe("zip");
      expect(target).toStartWith("win-");
    } else {
      expect(archive).toBe("tar.gz");
    }
  });

  test("parseVersion strips v prefix", () => {
    expect(parseVersion("v0.3.0")).toBe("0.3.0");
    expect(parseVersion("0.3.0")).toBe("0.3.0");
    expect(parseVersion("v1.2.3")).toBe("1.2.3");
  });

  test("compareVersions compares correctly", () => {
    expect(compareVersions("0.2.0", "0.3.0")).toBeLessThan(0);
    expect(compareVersions("0.3.0", "0.2.0")).toBeGreaterThan(0);
    expect(compareVersions("0.2.0", "0.2.0")).toBe(0);
    expect(compareVersions("1.0.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareVersions("0.2.0", "0.2.1")).toBeLessThan(0);
    expect(compareVersions("0.10.0", "0.9.0")).toBeGreaterThan(0);
  });
});
