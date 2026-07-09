import { describe, expect, test } from "bun:test";
import { expectedChecksum, resolveTarget, sha256 } from "../../scripts/npm/postinstall.mjs";

describe("npm postinstall", () => {
  test("maps supported platforms to release targets", () => {
    expect(resolveTarget("darwin", "arm64")).toBe("darwin-arm64");
    expect(resolveTarget("darwin", "x64")).toBe("darwin-x64");
    expect(resolveTarget("linux", "x64")).toBe("linux-x64");
    expect(resolveTarget("linux", "arm64")).toBe("linux-arm64");
    expect(resolveTarget("win32", "x64")).toBe("win-x64");
  });

  test("rejects unsupported platforms", () => {
    expect(() => resolveTarget("win32", "arm64")).toThrow("Unsupported platform");
    expect(() => resolveTarget("freebsd", "x64")).toThrow("Unsupported platform");
    expect(() => resolveTarget("linux", "ia32")).toThrow("Unsupported platform");
  });

  test("verifies sha256 against checksums.txt format", () => {
    const binary = Buffer.from("fake-binary-contents");
    const hash = sha256(binary);
    const checksums = `${hash}  zond-linux-x64\nother-hash  zond-win-x64.exe\n`;
    expect(expectedChecksum(checksums, "zond-linux-x64")).toBe(hash);
    expect(expectedChecksum(checksums, "zond-win-x64.exe")).toBe("other-hash");
    expect(() => expectedChecksum(checksums, "zond-darwin-arm64")).toThrow("No entry");
  });
});
