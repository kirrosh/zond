---
description: "Start or stop the zond WebUI dashboard"
argument-hint: "[on|off]"
---

You are managing the zond WebUI server using the manage_server MCP tool.

## Instructions

1. **Determine action from argument:**
   - If `$ARGUMENTS` is "off", "stop", or "false" → action is "stop"
   - If `$ARGUMENTS` is "on", "start", "true", or empty → action is "start"
   - If `$ARGUMENTS` is "restart" → action is "restart"
   - If `$ARGUMENTS` is "status" → action is "status"

2. **Execute:**
   ```
   manage_server(action: "<determined-action>")
   ```

3. **Report result:**
   - If started: show the URL (default http://localhost:8080)
   - If stopped: confirm server stopped
   - If status: show running state and port
