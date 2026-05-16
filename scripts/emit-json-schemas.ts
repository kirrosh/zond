#!/usr/bin/env bun
/**
 * TASK-295: regenerate `docs/json-schema/*.schema.json` from the zod
 * sources in `src/cli/json-schemas.ts`. Run after editing any envelope
 * shape so downstream consumers (agents, CI, third-party validators)
 * pick up the change.
 *
 * Usage:
 *   bun run scripts/emit-json-schemas.ts
 *   bun run scripts/emit-json-schemas.ts --check   # exit 1 if drift
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { z } from "zod";
import { SCHEMAS } from "../src/cli/json-schemas.ts";

const OUT_DIR = join(import.meta.dir, "..", "docs", "json-schema");

function emitAll(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, schema] of Object.entries(SCHEMAS)) {
    const json = z.toJSONSchema(schema);
    out[`${name}.schema.json`] = JSON.stringify(json, null, 2) + "\n";
  }
  return out;
}

function main(): void {
  const checkMode = process.argv.includes("--check");
  const generated = emitAll();

  if (checkMode) {
    let drift = 0;
    for (const [name, content] of Object.entries(generated)) {
      const path = join(OUT_DIR, name);
      if (!existsSync(path)) {
        console.error(`[drift] missing ${path}`);
        drift++;
        continue;
      }
      const onDisk = readFileSync(path, "utf-8");
      if (onDisk !== content) {
        console.error(`[drift] ${path} is stale — re-run \`bun run schemas\``);
        drift++;
      }
    }
    if (drift > 0) {
      process.exit(1);
    }
    console.error(`[ok] ${Object.keys(generated).length} schemas in sync`);
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  for (const [name, content] of Object.entries(generated)) {
    const path = join(OUT_DIR, name);
    writeFileSync(path, content);
    console.error(`[wrote] ${path}`);
  }
}

main();
