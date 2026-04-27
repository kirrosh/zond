import { z } from "zod";

import { getRuns } from "../../core/diagnostics/db-analysis.ts";
import type { McpTool } from "./types.ts";

const inputSchema = z.object({
  limit: z.number().int().positive().optional().describe("Max runs to return (default 20)"),
});

type Input = z.infer<typeof inputSchema>;

export const zondDbRunsTool: McpTool<Input> = {
  name: "zond_db_runs",
  description: "List recent test runs (id, status counts, environment, duration). Same data as `zond db runs --json`.",
  inputSchema,
  handler: (input, ctx) => {
    const runs = getRuns(input.limit, ctx.dbPath);
    return { runs };
  },
};
