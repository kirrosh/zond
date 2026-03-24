import { describe, test, expect, mock, afterEach } from "bun:test";
import { guideCommand } from "../../src/cli/commands/guide.ts";
import { closeDb } from "../../src/db/schema.ts";

const FIXTURES = `${import.meta.dir}/../fixtures`;

function suppressOutput() {
  const origOut = process.stdout.write;
  const origErr = process.stderr.write;
  const origLog = console.log;
  let captured = "";
  process.stdout.write = mock((data: any) => { captured += String(data); return true; }) as typeof process.stdout.write;
  process.stderr.write = mock(() => true) as typeof process.stderr.write;
  console.log = mock((...args: unknown[]) => { captured += args.map(String).join(" ") + "\n"; });
  return {
    restore() {
      process.stdout.write = origOut;
      process.stderr.write = origErr;
      console.log = origLog;
    },
    getCaptured() { return captured; },
  };
}

describe("guideCommand", () => {
  let output: ReturnType<typeof suppressOutput>;

  afterEach(() => {
    output?.restore();
    closeDb();
  });

  test("generates guide for spec --json", async () => {
    output = suppressOutput();
    const code = await guideCommand({
      specPath: `${FIXTURES}/petstore-simple.json`,
      json: true,
    });
    expect(code).toBe(0);
    const envelope = JSON.parse(output.getCaptured());
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe("guide");
    expect(envelope.data.endpointCount).toBeGreaterThan(0);
    expect(typeof envelope.data.guide).toBe("string");
  });

  test("generates guide in human mode", async () => {
    output = suppressOutput();
    const code = await guideCommand({
      specPath: `${FIXTURES}/petstore-simple.json`,
    });
    expect(code).toBe(0);
    const text = output.getCaptured();
    expect(text).toContain("Test Generation Guide");
  });

  test("returns 2 for nonexistent spec", async () => {
    output = suppressOutput();
    const code = await guideCommand({
      specPath: `${FIXTURES}/nonexistent.json`,
      json: true,
    });
    expect(code).toBe(2);
    const envelope = JSON.parse(output.getCaptured());
    expect(envelope.ok).toBe(false);
  });
});
