import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerRunTestsTool } from "./tools/run-tests.ts";
import { registerQueryDbTool } from "./tools/query-db.ts";
import { registerSendRequestTool } from "./tools/send-request.ts";
import { registerCoverageAnalysisTool } from "./tools/coverage-analysis.ts";
import { registerSaveTestSuiteTool, registerSaveTestSuitesTool } from "./tools/save-test-suite.ts";
import { registerSetupApiTool } from "./tools/setup-api.ts";
import { registerManageServerTool } from "./tools/manage-server.ts";
import { registerCiInitTool } from "./tools/ci-init.ts";
import { registerSetWorkDirTool } from "./tools/set-work-dir.ts";
import { registerDescribeEndpointTool } from "./tools/describe-endpoint.ts";
import { registerGenerateAndSaveTool } from "./tools/generate-and-save.ts";
import { version } from "../../package.json";

export interface McpServerOptions {
  dbPath?: string;
}

export async function startMcpServer(options: McpServerOptions = {}): Promise<void> {
  const { dbPath } = options;

  const server = new McpServer({
    name: "zond",
    version,
  });

  // Register all tools
  registerRunTestsTool(server, dbPath);
  registerQueryDbTool(server, dbPath);
  registerSendRequestTool(server, dbPath);
  registerCoverageAnalysisTool(server, dbPath);
  registerSaveTestSuiteTool(server, dbPath);
  registerSaveTestSuitesTool(server, dbPath);
  registerSetupApiTool(server, dbPath);
  registerManageServerTool(server, dbPath);
  registerCiInitTool(server);
  registerSetWorkDirTool(server);
  registerDescribeEndpointTool(server);
  registerGenerateAndSaveTool(server);

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
