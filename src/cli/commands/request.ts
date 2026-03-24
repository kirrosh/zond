import { sendAdHocRequest } from "../../core/runner/send-request.ts";
import { printError } from "../output.ts";
import { jsonOk, jsonError, printJson } from "../json-envelope.ts";

export interface RequestOptions {
  method: string;
  url: string;
  headers?: string[];
  body?: string;
  timeout?: number;
  env?: string;
  api?: string;
  jsonPath?: string;
  dbPath?: string;
  json?: boolean;
}

export async function requestCommand(options: RequestOptions): Promise<number> {
  try {
    const headers: Record<string, string> = {};
    if (options.headers) {
      for (const h of options.headers) {
        const colonIdx = h.indexOf(":");
        if (colonIdx > 0) {
          headers[h.slice(0, colonIdx).trim()] = h.slice(colonIdx + 1).trim();
        }
      }
    }

    const result = await sendAdHocRequest({
      method: options.method.toUpperCase(),
      url: options.url,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      body: options.body,
      timeout: options.timeout,
      envName: options.env,
      collectionName: options.api,
      jsonPath: options.jsonPath,
      dbPath: options.dbPath,
    });

    if (options.json) {
      printJson(jsonOk("request", result));
    } else {
      console.log(JSON.stringify(result, null, 2));
    }
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (options.json) {
      printJson(jsonError("request", [message]));
    } else {
      printError(message);
    }
    return 1;
  }
}
