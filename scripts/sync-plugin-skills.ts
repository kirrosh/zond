// Sync init-templates skills → root skills/<name>/SKILL.md (plugin layout).
// Source of truth: src/cli/commands/init/templates/skills/*.md.
// Run: bun run scripts/sync-plugin-skills.ts [--check]
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, basename } from "node:path";

const SRC = "src/cli/commands/init/templates/skills";
const DST = "skills";
const check = process.argv.includes("--check");

let drift = false;
for (const file of readdirSync(SRC).filter((f) => f.endsWith(".md"))) {
  const name = basename(file, ".md");
  const content = readFileSync(join(SRC, file), "utf8");
  const target = join(DST, name, "SKILL.md");
  const current = existsSync(target) ? readFileSync(target, "utf8") : null;
  if (current === content) continue;
  if (check) {
    console.error(`drift: ${target} != ${join(SRC, file)}`);
    drift = true;
  } else {
    mkdirSync(join(DST, name), { recursive: true });
    writeFileSync(target, content);
    console.log(`synced: ${target}`);
  }
}
if (check && drift) {
  console.error("Run: bun run scripts/sync-plugin-skills.ts");
  process.exit(1);
}
