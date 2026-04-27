import { join } from "node:path";

import type { McpClientSpec } from "./types.ts";

export const claudeSpec: McpClientSpec = {
  id: "claude",
  displayName: "Claude Code",
  configPath(home) {
    return join(home, ".claude", "mcp.json");
  },
  serverKey: "zond",
  serverEntry: {
    command: "zond",
    args: ["mcp", "start"],
  },
};
