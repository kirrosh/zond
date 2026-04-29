import { describe, test, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { parseFile, formatYamlParseError } from "../../src/core/parser/yaml-parser.ts";

const dirs: string[] = [];
function tmpFile(name: string, content: string): string {
  const dir = mkdtempSync(join(tmpdir(), "zond-yaml-err-"));
  dirs.push(dir);
  const file = join(dir, name);
  writeFileSync(file, content, "utf-8");
  return file;
}

afterEach(() => {
  for (const d of dirs.splice(0)) {
    try { rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

describe("YAML parse errors — TASK-71 (file:line:col diagnostics)", () => {
  test("colon inside test-name shows file:line:col with column pointer", async () => {
    const file = tmpFile("colon.yaml", [
      "name: foo",
      "tests:",
      "  - name: hello (note: world)",
      "",
    ].join("\n"));

    const err = await parseFile(file).then(() => null, (e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    const msg = err!.message;
    // Expect file:3:<col> prefix (col depends on first offending char — at least there)
    expect(msg).toMatch(new RegExp(`Invalid YAML in .+colon\\.yaml:3:\\d+:`));
    // Snippet with arrow pointer is preserved from eemeli/yaml.
    expect(msg).toContain("^");
    expect(msg).not.toContain("Unexpected character"); // generic Bun text replaced
  });

  test("NUL byte in source: file:line:col + suggests $nullByte generator", async () => {
    const file = tmpFile("nul.yaml", "name: foo\nbody: a\x00b\n");

    const err = await parseFile(file).then(() => null, (e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    const msg = err!.message;
    expect(msg).toMatch(new RegExp(`Invalid YAML in .+nul\\.yaml:2:8:`));
    expect(msg).toContain("NUL byte");
    expect(msg).toContain("$nullByte");
  });

  test("tab as indentation: precise row:col", async () => {
    const file = tmpFile("tab.yaml", "name: foo\ntests:\n\t- name: bar\n");

    const err = await parseFile(file).then(() => null, (e: Error) => e);
    expect(err).toBeInstanceOf(Error);
    expect(err!.message).toMatch(new RegExp(`Invalid YAML in .+tab\\.yaml:3:1:`));
  });

  test("formatYamlParseError() exported helper produces file:line:col output", () => {
    const text = "name: \"unterminated\nfoo: bar\n";
    const formatted = formatYamlParseError("/some/path/x.yaml", text, new Error("bun message"));
    expect(formatted.message).toMatch(/Invalid YAML in \/some\/path\/x\.yaml:\d+:\d+:/);
  });
});
