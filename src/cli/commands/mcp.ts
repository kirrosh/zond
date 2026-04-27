import { startMcpServer } from "../../mcp/index.ts";
import { printError } from "../output.ts";

export interface McpStartOptions {
  dbPath?: string;
}

export async function mcpStartCommand(opts: McpStartOptions): Promise<number> {
  try {
    await startMcpServer({ stdio: true, dbPath: opts.dbPath });
    return 0;
  } catch (err) {
    printError(err instanceof Error ? err.message : String(err));
    return 1;
  }
}
