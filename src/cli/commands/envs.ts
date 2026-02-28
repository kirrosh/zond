import { getDb } from "../../db/schema.ts";
import {
  listEnvironmentRecords,
  getEnvironment,
  upsertEnvironment,
  deleteEnvironment,
  getEnvironmentById,
} from "../../db/queries.ts";
import { printError, printSuccess } from "../output.ts";

export interface EnvsOptions {
  action: "list" | "get" | "set" | "delete";
  name?: string;
  pairs?: string[];
  dbPath?: string;
}

export function parseKeyValuePairs(pairs: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const pair of pairs) {
    const idx = pair.indexOf("=");
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    const value = pair.slice(idx + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}

export function envsCommand(options: EnvsOptions): number {
  const { action, name, pairs, dbPath } = options;

  try {
    getDb(dbPath);
  } catch (err) {
    printError(`Failed to open database: ${(err as Error).message}`);
    return 2;
  }

  switch (action) {
    case "list": {
      const envs = listEnvironmentRecords();
      if (envs.length === 0) {
        console.log("No environments found.");
        return 0;
      }

      // Print table
      const nameWidth = Math.max(4, ...envs.map(e => e.name.length));
      const header = `${"NAME".padEnd(nameWidth)}  VARIABLES`;
      console.log(header);
      console.log("-".repeat(header.length + 10));
      for (const env of envs) {
        const varKeys = Object.keys(env.variables).join(", ");
        console.log(`${env.name.padEnd(nameWidth)}  ${varKeys}`);
      }
      return 0;
    }

    case "get": {
      if (!name) {
        printError("Missing environment name. Usage: apitool envs get <name>");
        return 2;
      }
      const variables = getEnvironment(name);
      if (!variables) {
        printError(`Environment '${name}' not found`);
        return 1;
      }

      const keyWidth = Math.max(3, ...Object.keys(variables).map(k => k.length));
      for (const [k, v] of Object.entries(variables)) {
        console.log(`${k.padEnd(keyWidth)}  ${v}`);
      }
      return 0;
    }

    case "set": {
      if (!name) {
        printError("Missing environment name. Usage: apitool envs set <name> KEY=VALUE ...");
        return 2;
      }
      if (!pairs || pairs.length === 0) {
        printError("Missing KEY=VALUE pairs. Usage: apitool envs set <name> KEY=VALUE ...");
        return 2;
      }
      const variables = parseKeyValuePairs(pairs);
      if (Object.keys(variables).length === 0) {
        printError("No valid KEY=VALUE pairs provided");
        return 2;
      }

      // Merge with existing
      const existing = getEnvironment(name) ?? {};
      const merged = { ...existing, ...variables };
      upsertEnvironment(name, merged);
      printSuccess(`Environment '${name}' updated (${Object.keys(variables).length} variable(s) set)`);
      return 0;
    }

    case "delete": {
      if (!name) {
        printError("Missing environment name. Usage: apitool envs delete <name>");
        return 2;
      }
      // Find by name to get ID
      const envs = listEnvironmentRecords();
      const env = envs.find(e => e.name === name);
      if (!env) {
        printError(`Environment '${name}' not found`);
        return 1;
      }
      deleteEnvironment(env.id);
      printSuccess(`Environment '${name}' deleted`);
      return 0;
    }

    default:
      printError(`Unknown action: ${action}`);
      return 2;
  }
}
