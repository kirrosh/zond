import { z } from "zod";

import { executeRun } from "../../core/runner/execute-run.ts";
import type { McpTool } from "./types.ts";

const inputSchema = z.object({
  testPath: z.string().min(1).describe("Path to test file or directory"),
  envName: z.string().optional().describe("Environment file name (.env.<name>.yaml)"),
  safe: z.boolean().optional().describe("Run only GET / auth endpoints (read-only)"),
  tag: z.array(z.string()).optional().describe("Filter suites by tags"),
  envVars: z.record(z.string(), z.string()).optional().describe("Inject env variables (overrides env file)"),
  dryRun: z.boolean().optional().describe("Show requests without sending them"),
});

type Input = z.infer<typeof inputSchema>;

export const zondRunTool: McpTool<Input> = {
  name: "zond_run",
  description: "Execute API test suites at the given path and persist a run. Returns runId and per-suite results.",
  inputSchema,
  handler: async (input, ctx) => {
    const result = await executeRun({
      testPath: input.testPath,
      envName: input.envName,
      trigger: "mcp",
      dbPath: ctx.dbPath,
      safe: input.safe,
      tag: input.tag,
      envVars: input.envVars,
      dryRun: input.dryRun,
    });
    return {
      runId: result.runId,
      results: result.results,
    };
  },
};
