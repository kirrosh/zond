import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerRunTestsTool } from "./tools/run-tests.ts";
import { registerValidateTestsTool } from "./tools/validate-tests.ts";
import { registerQueryDbTool } from "./tools/query-db.ts";
import { registerSendRequestTool } from "./tools/send-request.ts";
import { registerExploreApiTool } from "./tools/explore-api.ts";
import { registerCoverageAnalysisTool } from "./tools/coverage-analysis.ts";
import { registerSaveTestSuiteTool, registerSaveTestSuitesTool } from "./tools/save-test-suite.ts";
import { registerGenerateTestsGuideTool } from "./tools/generate-tests-guide.ts";
import { registerSetupApiTool } from "./tools/setup-api.ts";
import { registerGenerateMissingTestsTool } from "./tools/generate-missing-tests.ts";
import { registerManageServerTool } from "./tools/manage-server.ts";
import { registerCiInitTool } from "./tools/ci-init.ts";
import { registerSetWorkDirTool } from "./tools/set-work-dir.ts";
import { registerDescribeEndpointTool } from "./tools/describe-endpoint.ts";
import { registerGenerateAndSaveTool } from "./tools/generate-and-save.ts";

export interface McpServerOptions {
  dbPath?: string;
}

export async function startMcpServer(options: McpServerOptions = {}): Promise<void> {
  const { dbPath } = options;

  const server = new McpServer({
    name: "apitool",
    version: "0.4.0",
  });

  // Register all tools
  registerRunTestsTool(server, dbPath);
  registerValidateTestsTool(server);
  registerQueryDbTool(server, dbPath);
  registerSendRequestTool(server, dbPath);
  registerExploreApiTool(server);
  registerCoverageAnalysisTool(server, dbPath);
  registerSaveTestSuiteTool(server, dbPath);
  registerSaveTestSuitesTool(server, dbPath);
  registerGenerateTestsGuideTool(server);
  registerSetupApiTool(server, dbPath);
  registerGenerateMissingTestsTool(server);
  registerManageServerTool(server, dbPath);
  registerCiInitTool(server);
  registerSetWorkDirTool(server);
  registerDescribeEndpointTool(server);
  registerGenerateAndSaveTool(server);

  // Connect via stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
}
