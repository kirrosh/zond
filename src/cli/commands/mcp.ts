import { startMcpServer } from "../../mcp/server.ts";
import { resolve } from "node:path";

export interface McpCommandOptions {
  dbPath?: string;
  dir?: string;
}

export async function mcpCommand(options: McpCommandOptions): Promise<number> {
  if (options.dir) {
    process.chdir(resolve(options.dir));
  }
  await startMcpServer({ dbPath: options.dbPath });
  // Server runs until stdin closes — this promise never resolves during normal operation
  return 0;
}
