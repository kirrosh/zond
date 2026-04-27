import { z } from "zod";

import { getRunDetail } from "../../core/diagnostics/db-analysis.ts";
import type { McpTool } from "./types.ts";

const inputSchema = z.object({
  runId: z.number().int().positive().describe("Run id"),
  verbose: z.boolean().optional().describe("Include all per-test results"),
});

type Input = z.infer<typeof inputSchema>;

export const zondDbRunTool: McpTool<Input> = {
  name: "zond_db_run",
  description: "Show details for a single run (run header + per-test results). Same data as `zond db run <id> --json`.",
  inputSchema,
  handler: (input, ctx) => {
    const detail = getRunDetail(input.runId, input.verbose, ctx.dbPath);
    return detail as unknown as Record<string, unknown>;
  },
};
