import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { parse } from "../../core/parser/yaml-parser.ts";

export function registerValidateTestsTool(server: McpServer) {
  server.registerTool("validate_tests", {
    description: "Validate YAML test files without running them. Returns parsed suite info or validation errors.",
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
