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

  test("tools/list returns registry entries (populated by TASK-6)", async () => {
    const res = await client.listTools();
    expect(Array.isArray(res.tools)).toBe(true);
    expect(res.tools.length).toBeGreaterThan(0);
  });

  test("T7 AC#1: resources/list returns the 8 static workflow/rules/reference resources", async () => {
    const res = await client.listResources();
    const uris = res.resources.map((r) => r.uri).sort();
    expect(uris).toEqual([
      "zond://reference/auth-patterns",
      "zond://reference/yaml",
      "zond://rules/never",
      "zond://rules/safety",
      "zond://workflow/diagnosis",
      "zond://workflow/scenarios",
      "zond://workflow/setup",
      "zond://workflow/test-api",
    ]);
    for (const r of res.resources) {
      expect(r.mimeType).toBe("text/markdown");
      expect(typeof r.name).toBe("string");
      expect(r.name!.length).toBeGreaterThan(0);
      expect(typeof r.description).toBe("string");
      expect(r.description!.length).toBeGreaterThan(0);
    }
  });

  test("T7 AC#1: resources/templates/list returns dynamic catalog and run-diagnosis templates", async () => {
    const res = await client.listResourceTemplates();
    const templates = res.resourceTemplates.map((t) => t.uriTemplate).sort();
    expect(templates).toEqual([
      "zond://catalog/{api}",
      "zond://run/{id}/diagnosis",
    ]);
  });

  test("T7 AC#2: resources/read returns markdown body for a static URI", async () => {
    const res = await client.readResource({ uri: "zond://rules/never" });
    expect(res.contents).toHaveLength(1);
    const content = res.contents[0] as { uri: string; mimeType?: string; text?: string };
    expect(content.uri).toBe("zond://rules/never");
    expect(content.mimeType).toBe("text/markdown");
    expect(typeof content.text).toBe("string");
    expect(content.text!.length).toBeGreaterThan(50);
    expect(content.text!.toLowerCase()).toContain("never");
  });

  test("T7 AC#2: resources/read fails cleanly for an unknown URI", async () => {
    await expect(
      client.readResource({ uri: "zond://does/not/exist" }),
    ).rejects.toThrow(/Unknown resource/);
  });

  test("T7 AC#2: resources/read for catalog template fails when no .api-catalog.yaml exists", async () => {
    await expect(
      client.readResource({ uri: "zond://catalog/no-such-api-12345" }),
    ).rejects.toThrow(/api-catalog\.yaml/);
  });
});
