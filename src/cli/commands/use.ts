import {
  clearCurrentApi,
  currentApiPath,
  readCurrentApi,
  writeCurrentApi,
} from "../../core/context/current.ts";
import { jsonError, jsonOk, printJson } from "../json-envelope.ts";
import { printError, printSuccess } from "../output.ts";

export interface UseOptions {
  api?: string;
  clear?: boolean;
  json?: boolean;
}

export async function useCommand(opts: UseOptions): Promise<number> {
  const path = currentApiPath();

  if (opts.clear) {
    const removed = clearCurrentApi();
    if (opts.json) {
      printJson(jsonOk("use", { action: "cleared", path, removed }));
    } else if (removed) {
      printSuccess(`Cleared ${path}`);
    } else {
      process.stdout.write(`No .zond-current file in ${process.cwd()}\n`);
    }
    return 0;
  }

  if (opts.api) {
    try {
      writeCurrentApi(opts.api);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (opts.json) printJson(jsonError("use", [message]));
      else printError(message);
      return 1;
    }
    if (opts.json) {
      printJson(jsonOk("use", { action: "set", api: opts.api, path }));
    } else {
      printSuccess(`Set current API to '${opts.api}' (${path})`);
    }
    return 0;
  }

  const current = readCurrentApi();
  if (opts.json) {
    printJson(jsonOk("use", { action: "show", api: current, path }));
  } else if (current) {
    process.stdout.write(`${current}\n`);
  } else {
    process.stdout.write(`No current API set. Run 'zond use <api>'.\n`);
  }
  return 0;
}
