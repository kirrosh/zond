import { tool } from "ai";
import { z } from "zod";
import { getDb } from "../../../db/schema.ts";
import { listEnvironmentRecords, getEnvironment, upsertEnvironment } from "../../../db/queries.ts";

export const manageEnvironmentTool = tool({
  description: "List, get, or set environment variables used for API test execution",
  inputSchema: z.object({
    action: z.enum(["list", "get", "set"]).describe("Action to perform"),
    name: z.string().optional().describe("Environment name"),
    variables: z.record(z.string(), z.string()).optional().describe("Variables to set (for set action)"),
  }),
  execute: async (args) => {
    try {
      getDb();

      switch (args.action) {
        case "list": {
          const environments = listEnvironmentRecords();
          return { environments };
        }
        case "get": {
          if (!args.name) return { error: "name is required for get action" };
          const variables = getEnvironment(args.name);
          if (!variables) return { error: `Environment '${args.name}' not found` };
          return { name: args.name, variables };
        }
        case "set": {
          if (!args.name || !args.variables) return { error: "name and variables are required for set action" };
          upsertEnvironment(args.name, args.variables);
          return { success: true, name: args.name };
        }
        default:
          return { error: `Unknown action: ${args.action}` };
      }
    } catch (err) {
      return { error: (err as Error).message };
    }
  },
});
