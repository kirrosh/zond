import { existsSync, readFileSync } from "fs";
import { resolve } from "path";
import { getDb } from "../../db/schema.ts";
import {
  listEnvironmentRecords,
  getEnvironment,
  upsertEnvironment,
  deleteEnvironment,
  getEnvironmentById,
  findCollectionByNameOrId,
} from "../../db/queries.ts";
import { printError, printSuccess } from "../output.ts";

export interface EnvsOptions {
  action: "list" | "get" | "set" | "delete" | "import" | "export";
  name?: string;
  pairs?: string[];
  file?: string;
  api?: string;
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

  // Resolve --api to collection_id
  let collectionId: number | undefined;
  if (options.api) {
    const col = findCollectionByNameOrId(options.api);
    if (!col) {
      printError(`API '${options.api}' not found`);
      return 1;
    }
    collectionId = col.id;
  }

  switch (action) {
    case "list": {
      const envs = listEnvironmentRecords(collectionId);
      if (envs.length === 0) {
        console.log("No environments found.");
        return 0;
      }

      // Print table
      const nameWidth = Math.max(4, ...envs.map(e => e.name.length));
      const scopeWidth = 8;
      const header = `${"NAME".padEnd(nameWidth)}  ${"SCOPE".padEnd(scopeWidth)}  VARIABLES`;
      console.log(header);
      console.log("-".repeat(header.length + 10));
      for (const env of envs) {
        const scope = env.collection_id ? `api:${env.collection_id}` : "global";
        const varKeys = Object.keys(env.variables).join(", ");
        console.log(`${env.name.padEnd(nameWidth)}  ${scope.padEnd(scopeWidth)}  ${varKeys}`);
      }
      return 0;
    }

    case "get": {
      if (!name) {
        printError("Missing environment name. Usage: apitool envs get <name>");
        return 2;
      }
      const variables = getEnvironment(name, collectionId);
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

      // Merge with existing (scoped if --api provided)
      const existing = getEnvironment(name, collectionId) ?? {};
      const merged = { ...existing, ...variables };
      upsertEnvironment(name, merged, collectionId);
      const scope = collectionId ? ` (scoped to api:${collectionId})` : "";
      printSuccess(`Environment '${name}' updated${scope} (${Object.keys(variables).length} variable(s) set)`);
      return 0;
    }

    case "delete": {
      if (!name) {
        printError("Missing environment name. Usage: apitool envs delete <name>");
        return 2;
      }
      // Find by name (and scope) to get ID
      const envs = listEnvironmentRecords(collectionId);
      const env = collectionId
        ? envs.find(e => e.name === name && e.collection_id === collectionId)
        : envs.find(e => e.name === name && e.collection_id === null);
      if (!env) {
        printError(`Environment '${name}' not found`);
        return 1;
      }
      deleteEnvironment(env.id);
      printSuccess(`Environment '${name}' deleted`);
      return 0;
    }

    case "import": {
      if (!name) {
        printError("Missing environment name. Usage: apitool envs import <name> <file>");
        return 2;
      }
      const file = options.file;
      if (!file) {
        printError("Missing file path. Usage: apitool envs import <name> <file>");
        return 2;
      }
      const filePath = resolve(file);
      if (!existsSync(filePath)) {
        printError(`File not found: ${filePath}`);
        return 1;
      }
      try {
        const content = readFileSync(filePath, "utf-8");
        const parsed = parseYamlEnv(content);
        if (!parsed || Object.keys(parsed).length === 0) {
          printError("No variables found in YAML file");
          return 1;
        }
        upsertEnvironment(name, parsed, collectionId);
        printSuccess(`Environment '${name}' imported (${Object.keys(parsed).length} variable(s))`);
        return 0;
      } catch (err) {
        printError(`Failed to import: ${(err as Error).message}`);
        return 1;
      }
    }

    case "export": {
      if (!name) {
        printError("Missing environment name. Usage: apitool envs export <name>");
        return 2;
      }
      const variables = getEnvironment(name, collectionId);
      if (!variables) {
        printError(`Environment '${name}' not found`);
        return 1;
      }
      console.log(toYaml(variables));
      return 0;
    }

    default:
      printError(`Unknown action: ${action}`);
      return 2;
  }
}

/** Parse a simple YAML key:value file into a flat Record */
export function parseYamlEnv(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf(":");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key) result[key] = value;
  }
  return result;
}

/** Serialize a flat Record as simple YAML */
export function toYaml(vars: Record<string, string>): string {
  const lines: string[] = [];
  for (const [k, v] of Object.entries(vars)) {
    // Quote values that contain special chars
    const needsQuote = /[:#\[\]{}&*!|>'"@`,%]/.test(v) || v.includes(" ") || v === "";
    lines.push(`${k}: ${needsQuote ? `"${v.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : v}`);
  }
  return lines.join("\n");
}
