import { z } from "zod";

import { diagnoseRun } from "../../core/diagnostics/db-analysis.ts";
import type { McpTool } from "./types.ts";

const inputSchema = z.object({
  runId: z.number().int().positive().describe("Run id from zond_run or zond_db_runs"),
  verbose: z.boolean().optional().describe("Include all examples (skip grouping)"),
  maxExamples: z.number().int().positive().optional().describe("Examples per failure group"),
});

type Input = z.infer<typeof inputSchema>;

export const zondDiagnoseTool: McpTool<Input> = {
  name: "zond_diagnose",
  description: "Diagnose a failed run. Returns the same structure as `zond db diagnose --json` data field — run/summary/failures/grouped_failures.",
  inputSchema,
  handler: (input, ctx) => {
    const result = diagnoseRun(input.runId, input.verbose, ctx.dbPath, input.maxExamples);
    return result as unknown as Record<string, unknown>;
  },
};
