import { tool } from "ai";
import { z } from "zod";
import { parse } from "../../parser/yaml-parser.ts";

export const validateTestsTool = tool({
  description: "Validate YAML test files without running them. Returns parsed suite info or validation errors.",
  inputSchema: z.object({
    testPath: z.string().describe("Path to test YAML file or directory"),
  }),
  execute: async (args) => {
    try {
      const suites = await parse(args.testPath);
      return {
        valid: true,
        suiteCount: suites.length,
        totalTests: suites.reduce((s, suite) => s + suite.tests.length, 0),
        suites: suites.map((s) => ({ name: s.name, testCount: s.tests.length })),
      };
    } catch (err) {
      return { valid: false, error: (err as Error).message };
    }
  },
});
