#!/usr/bin/env bun

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const root = join(import.meta.dir, "..");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));

const files = [
  ".claude-plugin/plugin.json",
  ".claude-plugin/marketplace.json",
];

for (const rel of files) {
  const path = join(root, rel);
  const json = JSON.parse(readFileSync(path, "utf-8"));

  if (rel.includes("marketplace")) {
    json.plugins[0].version = version;
  } else {
    json.version = version;
  }

  writeFileSync(path, JSON.stringify(json, null, 2) + "\n");
  console.log(`${rel} → ${version}`);
}
