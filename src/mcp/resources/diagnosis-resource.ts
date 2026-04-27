import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

import { diagnoseRun } from "../../core/diagnostics/db-analysis.ts";
import { renderDiagnosisMarkdown } from "../../core/diagnostics/render-md.ts";
import type { McpResourceTemplate } from "./types.ts";

const URI_RE = /^zond:\/\/run\/(\d+)\/diagnosis$/;

export const diagnosisResourceTemplate: McpResourceTemplate = {
  uriTemplate: "zond://run/{id}/diagnosis",
  name: "Run diagnosis",
  description:
    "Markdown digest of a failed test run: summary, agent_directive, auth/env hints, cascade skips, grouped failures. `{id}` is the integer run id (see `zond_db_runs` tool).",
  mimeType: "text/markdown",
  match(uri) {
    const m = URI_RE.exec(uri);
    if (!m) return null;
    return { id: m[1]! };
  },
  read(params, uri, ctx) {
    const idStr = params.id;
    if (!idStr) {
      throw new McpError(ErrorCode.InvalidParams, `Missing 'id' segment in ${uri}`);
    }
    const id = Number.parseInt(idStr, 10);
    if (!Number.isFinite(id) || id <= 0) {
      throw new McpError(ErrorCode.InvalidParams, `Invalid run id: ${idStr}`);
    }
    let result;
    try {
      result = diagnoseRun(id, false, ctx.dbPath);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new McpError(ErrorCode.InvalidParams, message);
    }
    const text = renderDiagnosisMarkdown(result);
    return {
      contents: [
        {
          uri,
          mimeType: "text/markdown",
          text,
        },
      ],
    };
  },
};
