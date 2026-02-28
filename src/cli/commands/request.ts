import { executeRequest } from "../../core/runner/http-client.ts";
import { loadEnvironment, substituteString } from "../../core/parser/variables.ts";
import { printError } from "../output.ts";

export interface RequestOptions {
  method: string;
  url: string;
  headers: string[];
  body?: string;
  env?: string;
  timeout?: number;
}

const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";

function useColor(): boolean {
  return process.stdout.isTTY ?? false;
}

function colorStatus(status: number): string {
  if (!useColor()) return String(status);
  if (status >= 200 && status < 300) return `${GREEN}${status}${RESET}`;
  if (status >= 300 && status < 400) return `${YELLOW}${status}${RESET}`;
  return `${RED}${status}${RESET}`;
}

export function parseHeaders(raw: string[]): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const h of raw) {
    const idx = h.indexOf(":");
    if (idx === -1) continue;
    const key = h.slice(0, idx).trim();
    const value = h.slice(idx + 1).trim();
    if (key) headers[key] = value;
  }
  return headers;
}

export async function requestCommand(options: RequestOptions): Promise<number> {
  const { method, url, headers: rawHeaders, body, env, timeout } = options;

  // Load environment for variable interpolation
  const vars = await loadEnvironment(env);

  // Interpolate URL
  const resolvedUrl = substituteString(url, vars) as string;

  // Parse and interpolate headers
  const parsedHeaders = parseHeaders(rawHeaders);
  const resolvedHeaders: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsedHeaders)) {
    resolvedHeaders[k] = substituteString(v, vars) as string;
  }

  // Auto-set Content-Type for body if not specified
  if (body && !Object.keys(resolvedHeaders).some(k => k.toLowerCase() === "content-type")) {
    try {
      JSON.parse(body);
      resolvedHeaders["Content-Type"] = "application/json";
    } catch {
      // Not JSON, leave without content-type
    }
  }

  // Interpolate body
  let resolvedBody: string | undefined;
  if (body) {
    resolvedBody = substituteString(body, vars) as string;
  }

  try {
    const response = await executeRequest(
      {
        method: method.toUpperCase(),
        url: resolvedUrl,
        headers: resolvedHeaders,
        body: resolvedBody,
      },
      timeout ? { timeout } : undefined,
    );

    const color = useColor();

    // Status line
    console.log(`${colorStatus(response.status)} ${method.toUpperCase()} ${resolvedUrl} ${color ? DIM : ""}(${response.duration_ms}ms)${color ? RESET : ""}`);

    // Headers
    console.log("");
    for (const [k, v] of Object.entries(response.headers)) {
      if (color) {
        console.log(`${CYAN}${k}${RESET}: ${v}`);
      } else {
        console.log(`${k}: ${v}`);
      }
    }

    // Body
    console.log("");
    if (response.body_parsed) {
      console.log(JSON.stringify(response.body_parsed, null, 2));
    } else if (response.body) {
      console.log(response.body);
    }

    return response.status >= 400 ? 1 : 0;
  } catch (err) {
    printError(err instanceof Error ? err.message : String(err));
    return 2;
  }
}
