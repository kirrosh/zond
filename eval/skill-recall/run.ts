// Agent-recall eval for zond skill descriptions (ARV-397).
// Simulates Claude Code's skill router: given the available-skills list
// (zond skills from a variant dir + fixed distractors) and a user message,
// which skill does the model invoke? Runs headless `claude -p` per phrase.
//
// Usage: bun run eval/skill-recall/run.ts <variant-dir> <out.json>
//   variant-dir: directory with <skill>.md files (frontmatter description)
// Baseline: bun run eval/skill-recall/run.ts src/cli/commands/init/templates/skills eval/skill-recall/results-baseline.json
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, basename } from "node:path";

const [variantDir, outFile] = process.argv.slice(2);
if (!variantDir || !outFile) {
  console.error("usage: bun run eval/skill-recall/run.ts <variant-dir> <out.json>");
  process.exit(1);
}

const DISTRACTORS: Record<string, string> = {
  "playwright-e2e": "End-to-end browser tests for web UI flows with Playwright: write, run and debug page-level tests, selectors, fixtures, screenshots.",
  "unit-tests": "Write and maintain unit tests for functions and modules (vitest/jest/bun test): mocks, table tests, coverage for pure logic.",
  "http-client": "Make ad-hoc HTTP requests from the terminal (curl-style): compose a request, inspect status/headers/body, save responses.",
  "code-review": "Review a diff or pull request for correctness bugs, style and simplification opportunities.",
  "docs-writer": "Write and update project documentation: README sections, guides, changelogs.",
};

function frontmatterDescription(md: string): string {
  const m = md.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return "";
  const fm = m[1];
  const dm = fm.match(/description:\s*\|\n([\s\S]*?)(?=\n\w|$)/) || fm.match(/description:\s*(.+)/);
  if (!dm) return "";
  return dm[1].replace(/^ {2}/gm, "").trim();
}

const skills: Record<string, string> = { ...DISTRACTORS };
for (const f of readdirSync(variantDir).filter((f) => f.endsWith(".md"))) {
  skills[basename(f, ".md")] = frontmatterDescription(readFileSync(join(variantDir, f), "utf8"));
}

const skillList = Object.entries(skills)
  .sort(() => 0.5 - Math.random())
  .map(([name, desc]) => `- ${name}: ${desc.replace(/\n/g, " ")}`)
  .join("\n");

const phrases = JSON.parse(readFileSync(join(import.meta.dir, "phrases.json"), "utf8"));
const all = [...phrases.positive, ...phrases.negative];

async function route(text: string): Promise<string> {
  const prompt = `You are the skill router of a coding agent. The following skills are available:

${skillList}

Rule (same as the real harness): when a skill matches the user's request, it MUST be invoked before doing anything else. If no skill clearly matches, answer "none".

User message: "${text}"

Which single skill do you invoke? Reply with EXACTLY the skill name or "none". No other text.`;
  const proc = Bun.spawn(["claude", "-p", prompt, "--output-format", "text"], { stdout: "pipe", stderr: "pipe" });
  const out = (await new Response(proc.stdout).text()).trim().toLowerCase();
  return out.split(/\s/)[0].replace(/[^a-z0-9-]/g, "") || "none";
}

const results: any[] = [];
for (const p of all) {
  const picked = await route(p.text);
  const zondFamily = picked.startsWith("zond") || picked === "warm-up-target";
  const hit = p.expect === "none-or-other" ? !zondFamily : zondFamily;
  results.push({ ...p, picked, hit });
  console.log(`${hit ? "✓" : "✗"} [${p.id}] "${p.text}" → ${picked}`);
}

const pos = results.filter((r) => r.expect !== "none-or-other");
const neg = results.filter((r) => r.expect === "none-or-other");
const summary = {
  variant: variantDir,
  recall: pos.filter((r) => r.hit).length / pos.length,
  exact: pos.filter((r) => r.picked === r.expect).length / pos.length,
  falseActivation: neg.filter((r) => !r.hit).length / neg.length,
  results,
};
writeFileSync(outFile, JSON.stringify(summary, null, 2));
console.log(`\nrecall=${(summary.recall * 100).toFixed(0)}% exact-skill=${(summary.exact * 100).toFixed(0)}% false-activation=${(summary.falseActivation * 100).toFixed(0)}% → ${outFile}`);
