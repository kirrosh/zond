import { existsSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";

import type { McpServerContext } from "../server.ts";
import type { McpResourceTemplate } from "./types.ts";

const URI_RE = /^zond:\/\/catalog\/([^/]+)$/;

export const catalogResourceTemplate: McpResourceTemplate = {
  uriTemplate: "zond://catalog/{api}",
  name: "API catalog",
  description:
    "Compact catalog (`.api-catalog.yaml`) for an API. `{api}` is the directory name (relative to MCP server cwd) that holds the catalog file.",
  mimeType: "application/yaml",
  match(uri) {
    const m = URI_RE.exec(uri);
    if (!m) return null;
    return { api: decodeURIComponent(m[1]!) };
  },
  async read(params, uri, ctx) {
    const api = params.api;
    if (!api) {
      throw new McpError(ErrorCode.InvalidParams, `Missing 'api' segment in ${uri}`);
    }
    if (api.includes("..") || isAbsolute(api)) {
      throw new McpError(ErrorCode.InvalidParams, `Invalid api segment: ${api}`);
    }
    const cwd = ctx.cwd ?? process.cwd();
    const file = await locateCatalog(api, cwd);
    if (!file) {
      throw new McpError(
        ErrorCode.InvalidParams,
        `No .api-catalog.yaml found for '${api}' relative to ${cwd}`,
      );
    }
    const text = await Bun.file(file).text();
    return {
      contents: [
        {
          uri,
          mimeType: "application/yaml",
          text,
        },
      ],
    };
  },
};

async function locateCatalog(api: string, cwd: string): Promise<string | null> {
  const nested = resolve(cwd, api, ".api-catalog.yaml");
  if (existsSync(nested)) return nested;
  const root = resolve(cwd, ".api-catalog.yaml");
  if (existsSync(root) && (await catalogApiNameMatches(root, api))) return root;
  return null;
}

async function catalogApiNameMatches(file: string, api: string): Promise<boolean> {
  try {
    const text = await Bun.file(file).text();
    const apiNameMatch = /^apiName:\s*(.+)$/m.exec(text);
    if (!apiNameMatch) return false;
    return (
      apiNameMatch[1]!
        .trim()
        .replace(/^["']|["']$/g, "")
        .toLowerCase() === api.toLowerCase()
    );
  } catch {
    return false;
  }
}
