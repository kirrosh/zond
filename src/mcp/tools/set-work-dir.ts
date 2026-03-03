import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { resolve, join } from "node:path";
import { existsSync } from "node:fs";
import { resetDb } from "../../db/schema.ts";
import { TOOL_DESCRIPTIONS } from "../descriptions.js";

export function registerSetWorkDirTool(server: McpServer) {
  server.registerTool("set_work_dir", {
    description: TOOL_DESCRIPTIONS.set_work_dir,
    inputSchema: {
      workDir: z.string().describe(
        "Absolute path to project root (e.g. /home/user/myproject or C:/Users/user/myproject)"
      ),
    },
  }, async ({ workDir }) => {
    const resolved = resolve(workDir);
    if (!existsSync(resolved)) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: `Directory not found: ${resolved}` }, null, 2) }],
        isError: true,
      };
    }
    process.chdir(resolved);
    resetDb();
    const dbPath = join(resolved, "apitool.db");
    return {
      content: [{ type: "text" as const, text: JSON.stringify({
        workDir: resolved,
        apitool_db: dbPath,
        hint: "Working directory set. All relative paths and apitool.db will now resolve from this directory.",
      }, null, 2) }],
    };
  });
}
