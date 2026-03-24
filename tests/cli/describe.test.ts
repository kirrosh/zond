import { describe, test, expect, mock, afterEach } from "bun:test";
import { describeCommand } from "../../src/cli/commands/describe.ts";

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

describe("describeCommand", () => {
  let output: ReturnType<typeof suppressOutput>;
  afterEach(() => output?.restore());

  test("--compact lists endpoints", async () => {
    output = suppressOutput();
    const code = await describeCommand({
      specPath: `${FIXTURES}/petstore-simple.json`,
      compact: true,
    });
    expect(code).toBe(0);
    const text = output.getCaptured();
    expect(text).toContain("GET");
    expect(text).toContain("/pets");
  });

  test("--compact --json returns envelope", async () => {
    output = suppressOutput();
    const code = await describeCommand({
      specPath: `${FIXTURES}/petstore-simple.json`,
      compact: true,
      json: true,
    });
    expect(code).toBe(0);
    const envelope = JSON.parse(output.getCaptured());
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe("describe");
    expect(Array.isArray(envelope.data.endpoints)).toBe(true);
  });

  test("returns 2 without --method/--path and not --compact", async () => {
    output = suppressOutput();
    const code = await describeCommand({
      specPath: `${FIXTURES}/petstore-simple.json`,
    });
    expect(code).toBe(2);
  });

  test("specific endpoint with --method and --path", async () => {
    output = suppressOutput();
    const code = await describeCommand({
      specPath: `${FIXTURES}/petstore-simple.json`,
      method: "GET",
      path: "/pets",
      json: true,
    });
    expect(code).toBe(0);
    const envelope = JSON.parse(output.getCaptured());
    expect(envelope.ok).toBe(true);
    expect(envelope.data.method).toBe("GET");
    expect(envelope.data.path).toBe("/pets");
  });
});
