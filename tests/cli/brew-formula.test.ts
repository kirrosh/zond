import { describe, expect, test } from "bun:test";
import { generateFormula } from "../../scripts/release/generate-brew-formula.mjs";

const checksums = [
  "aaa1  zond-darwin-arm64.tar.gz",
  "aaa2  zond-darwin-x64.tar.gz",
  "aaa3  zond-linux-arm64.tar.gz",
  "aaa4  zond-linux-x64.tar.gz",
  "ffff  zond-win-x64.zip",
].join("\n");

describe("brew formula generator", () => {
  test("emits a formula with per-platform url + sha256", () => {
    const rb = generateFormula("0.27.0", checksums);
    expect(rb).toContain('version "0.27.0"');
    expect(rb).toContain("releases/download/v0.27.0/zond-darwin-arm64.tar.gz");
    expect(rb).toContain('sha256 "aaa1"');
    expect(rb).toContain('sha256 "aaa2"');
    expect(rb).toContain('sha256 "aaa3"');
    expect(rb).toContain('sha256 "aaa4"');
    expect(rb).toContain('bin.install "zond"');
  });

  test("fails loudly on a missing artifact checksum", () => {
    expect(() => generateFormula("0.27.0", "aaa1  zond-darwin-arm64.tar.gz")).toThrow(
      "No checksum for zond-darwin-x64.tar.gz",
    );
  });
});
