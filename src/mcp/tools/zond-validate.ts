import { z } from "zod";

import { parse } from "../../core/parser/yaml-parser.ts";
import type { McpTool } from "./types.ts";

const inputSchema = z.object({
  path: z.string().min(1).describe("Path to a YAML test file or directory of suites"),
});

type Input = z.infer<typeof inputSchema>;

export const zondValidateTool: McpTool<Input> = {
  name: "zond_validate",
  description: "Validate test YAML without running. Returns counts (files, suites, tests). Throws an MCP error with parse/schema diagnostics when invalid.",
  inputSchema,
  handler: async (input) => {
    const suites = await parse(input.path);
    const totalSteps = suites.reduce((sum, s) => sum + s.tests.length, 0);
    return {
      files: suites.length,
      suites: suites.length,
      tests: totalSteps,
      valid: true,
    };
  },
};
