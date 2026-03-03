import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { parse } from "../../core/parser/yaml-parser.ts";
import { TOOL_DESCRIPTIONS } from "../descriptions.js";

export function registerValidateTestsTool(server: McpServer) {
  server.registerTool("validate_tests", {
    description: TOOL_DESCRIPTIONS.validate_tests,
    inputSchema: {
      testPath: z.string().describe("Path to test YAML file or directory"),
    },
  }, async ({ testPath }) => {
    try {
      const suites = await parse(testPath);
      const totalSteps = suites.reduce((sum, s) => sum + s.tests.length, 0);

      const result = {
        valid: true,
        suites: suites.length,
        tests: totalSteps,
        details: suites.map(s => ({
          name: s.name,
          tests: s.tests.length,
          tags: s.tags,
          description: s.description,
          source: (s as any)._source,
        })),
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          valid: false,
          error: (err as Error).message,
        }, null, 2) }],
        isError: true,
      };
    }
  });
}
