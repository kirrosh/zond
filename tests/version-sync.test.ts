import { test, expect } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const root = join(import.meta.dir, "..");

function readJson(rel: string) {
  return JSON.parse(readFileSync(join(root, rel), "utf-8"));
}

test("plugin.json version matches package.json", () => {
  const { version } = readJson("package.json");
  const pluginVersion = readJson(".claude-plugin/plugin.json").version;

  expect(pluginVersion).toBe(version);
});
