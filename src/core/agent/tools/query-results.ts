import { tool } from "ai";
import { z } from "zod";
import { getDb } from "../../../db/schema.ts";
import { listRuns, getRunById, getResultsByRunId, listCollections } from "../../../db/queries.ts";

export const queryResultsTool = tool({
  description: "Query test run results and collections from the database",
  inputSchema: z.object({
    action: z.enum(["list_runs", "get_run", "list_collections"]).describe("Action to perform"),
    runId: z.number().optional().describe("Run ID (for get_run action)"),
    limit: z.number().optional().describe("Max results to return (default: 20)"),
  }),
  execute: async (args) => {
    try {
      getDb();

      switch (args.action) {
        case "list_runs": {
          const runs = listRuns(args.limit ?? 20);
          return { runs };
        }
        case "get_run": {
          if (args.runId == null) return { error: "runId is required for get_run action" };
          const run = getRunById(args.runId);
          if (!run) return { error: `Run ${args.runId} not found` };
          const results = getResultsByRunId(args.runId);
          return { run, results };
        }
        case "list_collections": {
          const collections = listCollections();
          return { collections };
        }
        default:
          return { error: `Unknown action: ${args.action}` };
      }
    } catch (err) {
      return { error: (err as Error).message };
    }
  },
});
