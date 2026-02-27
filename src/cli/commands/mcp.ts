import { startMcpServer } from "../../mcp/server.ts";

export interface McpCommandOptions {
  dbPath?: string;
}

export async function mcpCommand(options: McpCommandOptions): Promise<number> {
  await startMcpServer({ dbPath: options.dbPath });
  // Server runs until stdin closes — this promise never resolves during normal operation
  return 0;
}
