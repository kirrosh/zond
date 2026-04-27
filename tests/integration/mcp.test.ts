import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { join } from "path";

const CLI_PATH = join(import.meta.dir, "..", "..", "src", "cli", "index.ts");

describe("MCP server (real stdio handshake)", () => {
  let client: Client;
  let transport: StdioClientTransport;

  beforeAll(async () => {
    transport = new StdioClientTransport({
      command: "bun",
      args: [CLI_PATH, "mcp", "start"],
    });
    client = new Client(
      { name: "zond-test-client", version: "0.0.0" },
      { capabilities: {} },
    );
    await client.connect(transport);
  });

  afterAll(async () => {
    await client.close();
  });

  test("AC#1: initialize handshake reports server name+version", () => {
    const info = client.getServerVersion();
    expect(info?.name).toBe("zond");
    expect(typeof info?.version).toBe("string");
    expect(info!.version.length).toBeGreaterThan(0);
  });

  test("AC#2: tools/list returns empty array (T5 stub)", async () => {
    const res = await client.listTools();
    expect(res.tools).toEqual([]);
  });

  test("AC#2: resources/list returns empty array (T5 stub)", async () => {
    const res = await client.listResources();
    expect(res.resources).toEqual([]);
  });
});
