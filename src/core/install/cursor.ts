import { join } from "node:path";

import type { McpClientSpec } from "./types.ts";

export const cursorSpec: McpClientSpec = {
  id: "cursor",
  displayName: "Cursor",
  configPath(home) {
    return join(home, ".cursor", "mcp.json");
  },
  serverKey: "zond",
  serverEntry: {
    command: "zond",
    args: ["mcp", "start"],
  },
};
