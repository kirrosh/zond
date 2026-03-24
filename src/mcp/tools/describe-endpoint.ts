import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describeEndpoint } from "../../core/generator/describe.ts";
import { TOOL_DESCRIPTIONS } from "../descriptions.js";

export function registerDescribeEndpointTool(server: McpServer) {
  server.registerTool("describe_endpoint", {
    description: TOOL_DESCRIPTIONS.describe_endpoint,
    inputSchema: {
      specPath: z.string().describe("Path to OpenAPI spec file (JSON or YAML) or HTTP URL"),
      method: z.string().describe('HTTP method, e.g. "GET", "POST", "PUT"'),
      path: z.string().describe('Endpoint path, e.g. "/pets/{petId}"'),
    },
  }, async ({ specPath, method, path: endpointPath }) => {
    try {
      const result = await describeEndpoint(specPath, method, endpointPath);
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: (err as Error).message }, null, 2) }],
        isError: true,
      };
    }
  });
}
