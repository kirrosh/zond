import { describe, test, expect, afterEach } from "bun:test";
import { describeCommand } from "../../src/cli/commands/describe.ts";
import { captureOutput } from "../_helpers/output";

const FIXTURES = `${import.meta.dir}/../fixtures`;

describe("describeCommand", () => {
  let output: ReturnType<typeof captureOutput>;
  afterEach(() => output?.restore());

  test("--compact lists endpoints", async () => {
    output = captureOutput({ console: true });
    const code = await describeCommand({
      specPath: `${FIXTURES}/petstore-simple.json`,
      compact: true,
    });
    expect(code).toBe(0);
    const text = output.out;
    expect(text).toContain("GET");
    expect(text).toContain("/pets");
  });

  test("--compact --json returns envelope", async () => {
    output = captureOutput({ console: true });
    const code = await describeCommand({
      specPath: `${FIXTURES}/petstore-simple.json`,
      compact: true,
      json: true,
    });
    expect(code).toBe(0);
    const envelope = JSON.parse(output.out);
    expect(envelope.ok).toBe(true);
    expect(envelope.command).toBe("describe");
    expect(Array.isArray(envelope.data.endpoints)).toBe(true);
  });

  test("TASK-211 — no flags defaults to compact listing (was: exit 2)", async () => {
    output = captureOutput({ console: true });
    const code = await describeCommand({
      specPath: `${FIXTURES}/petstore-simple.json`,
    });
    expect(code).toBe(0);
    const text = output.out;
    expect(text).toContain("GET");
    expect(text).toContain("/pets");
  });

  test("--method without --path errors with exit 2", async () => {
    output = captureOutput({ console: true });
    const code = await describeCommand({
      specPath: `${FIXTURES}/petstore-simple.json`,
      method: "GET",
    });
    expect(code).toBe(2);
  });

  test("specific endpoint with --method and --path", async () => {
    output = captureOutput({ console: true });
    const code = await describeCommand({
      specPath: `${FIXTURES}/petstore-simple.json`,
      method: "GET",
      path: "/pets",
      json: true,
    });
    expect(code).toBe(0);
    const envelope = JSON.parse(output.out);
    expect(envelope.ok).toBe(true);
    expect(envelope.data.method).toBe("GET");
    expect(envelope.data.path).toBe("/pets");
  });
});
