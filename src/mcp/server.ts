import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerRunTestsTool } from "./tools/run-tests.ts";
import { registerQueryDbTool } from "./tools/query-db.ts";
import { registerSendRequestTool } from "./tools/send-request.ts";
import { registerCoverageAnalysisTool } from "./tools/coverage-analysis.ts";
import { registerSetupApiTool } from "./tools/setup-api.ts";
import { registerManageServerTool } from "./tools/manage-server.ts";
import { registerCiInitTool } from "./tools/ci-init.ts";
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

  // Register tools (slim set — removed set_work_dir, save_test_suite, save_test_suites)
  registerRunTestsTool(server, dbPath);
  registerQueryDbTool(server, dbPath);
  registerSendRequestTool(server, dbPath);
  registerCoverageAnalysisTool(server, dbPath);
  registerSetupApiTool(server, dbPath);
  registerManageServerTool(server, dbPath);
  registerCiInitTool(server);
  registerDescribeEndpointTool(server);
  registerGenerateAndSaveTool(server);

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
