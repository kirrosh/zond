import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { TOOL_DESCRIPTIONS } from "../descriptions.js";
let serverInstance: ReturnType<typeof Bun.serve> | null = null;
let serverPort: number = 0;

export function registerManageServerTool(server: McpServer, dbPath?: string) {
  server.registerTool("manage_server", {
    description: TOOL_DESCRIPTIONS.manage_server,
    inputSchema: {
      action: z.enum(["start", "stop", "restart", "status"]).describe("Action to perform"),
      port: z.optional(z.number().int().min(1).max(65535)).describe("Port number (default: 8080, only for start/restart)"),
    },
  }, async ({ action, port }) => {
    const targetPort = port ?? 8080;

    switch (action) {
      case "start": {
        if (serverInstance) {
          return result({ running: true, port: serverPort, url: `http://localhost:${serverPort}`, message: "Server already running" });
        }
        return await startServer(targetPort, dbPath);
      }

      case "stop": {
        if (!serverInstance) {
          return result({ running: false, message: "Server is not running" });
        }
        serverInstance.stop();
        serverInstance = null;
        const stoppedPort = serverPort;
        serverPort = 0;
        return result({ running: false, message: `Server stopped (was on port ${stoppedPort})` });
      }

      case "restart": {
        if (serverInstance) {
          serverInstance.stop();
          serverInstance = null;
          serverPort = 0;
        }
        return await startServer(targetPort, dbPath);
      }

      case "status": {
        if (serverInstance) {
          return result({ running: true, port: serverPort, url: `http://localhost:${serverPort}` });
        }
        return result({ running: false });
      }
    }
  });
}

async function startServer(port: number, dbPath?: string) {
  try {
    const { getDb } = await import("../../db/schema.ts");
    const { createApp } = await import("../../web/server.ts");

    getDb(dbPath);
    const app = createApp();

    serverInstance = Bun.serve({
      fetch: app.fetch,
      port,
      hostname: "0.0.0.0",
    });
    serverPort = port;

    return result({ running: true, port, url: `http://localhost:${port}`, message: "Server started" });
  } catch (err) {
    return {
      content: [{ type: "text" as const, text: JSON.stringify({
        running: false,
        error: (err as Error).message,
      }, null, 2) }],
      isError: true,
    };
  }
}

function result(data: Record<string, unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}
