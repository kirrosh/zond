#!/usr/bin/env bun

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const root = join(import.meta.dir, "..");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));

// Sync version in plugin.json (authoritative source for plugin version)
const pluginPath = join(root, ".claude-plugin/plugin.json");
const pluginJson = JSON.parse(readFileSync(pluginPath, "utf-8"));
pluginJson.version = version;
writeFileSync(pluginPath, JSON.stringify(pluginJson, null, 2) + "\n");
console.log(`.claude-plugin/plugin.json → ${version}`);
