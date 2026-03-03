import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ciInitCommand } from "../../cli/commands/ci-init.ts";
import { TOOL_DESCRIPTIONS } from "../descriptions.js";

export function registerCiInitTool(server: McpServer) {
  server.registerTool("ci_init", {
    description: TOOL_DESCRIPTIONS.ci_init,
    inputSchema: {
      platform: z.optional(z.enum(["github", "gitlab"]))
        .describe("CI platform. If omitted, auto-detects from project structure (defaults to GitHub)"),
      force: z.optional(z.boolean())
        .describe("Overwrite existing CI config (default: false)"),
      dir: z.optional(z.string())
        .describe("Project root directory where CI config will be created (default: current working directory)"),
    },
  }, async ({ platform, force, dir }) => {
    // Capture stdout to return as result
    const logs: string[] = [];
    const origWrite = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      logs.push(typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk));
      return true;
    }) as typeof process.stdout.write;

    try {
      const code = await ciInitCommand({
        platform,
        force: force ?? false,
        dir,
      });

      process.stdout.write = origWrite;

      const output = logs.join("").trim();
      if (code !== 0) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ error: output || "ci init failed", exitCode: code }, null, 2) }],
          isError: true,
        };
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify({ message: output, exitCode: 0 }, null, 2) }],
      };
    } catch (err) {
      process.stdout.write = origWrite;
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: (err as Error).message }, null, 2) }],
        isError: true,
      };
    }
  });
}
