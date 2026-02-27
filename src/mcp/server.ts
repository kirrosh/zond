import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerRunTestsTool } from "./tools/run-tests.ts";
import { registerValidateTestsTool } from "./tools/validate-tests.ts";
import { registerGenerateTestsTool } from "./tools/generate-tests.ts";
import { registerListCollectionsTool } from "./tools/list-collections.ts";
import { registerListRunsTool } from "./tools/list-runs.ts";
import { registerGetRunResultsTool } from "./tools/get-run-results.ts";
import { registerListEnvironmentsTool } from "./tools/list-environments.ts";

export interface McpServerOptions {
  dbPath?: string;
}

export async function startMcpServer(options: McpServerOptions = {}): Promise<void> {
  const { dbPath } = options;

  const server = new McpServer({
    name: "apitool",
    version: "0.1.0",
  });

  // Register all tools
  registerRunTestsTool(server, dbPath);
  registerValidateTestsTool(server);
  registerGenerateTestsTool(server);
  registerListCollectionsTool(server, dbPath);
  registerListRunsTool(server, dbPath);
  registerGetRunResultsTool(server, dbPath);
  registerListEnvironmentsTool(server, dbPath);

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
