/**
 * ARV-29 regression: the `--api` flag must never be declared via commander's
 * `.requiredOption()` because zond defines `--api` as a *program-level* option
 * too — commander then routes the value to the global slot, leaves the
 * subcommand's `opts.api` undefined, and `requiredOption()` rejects every
 * invocation form (including `zond --api foo subcmd`).
 *
 * History: TASK-17 fixed `checks run`, TASK-20 fixed `prepare-fixtures`,
 * ARV-29 fixed `audit` — same paste-from-template bug each time. This test
 * pins it across the whole `src/cli/commands` tree so the next subcommand
 * author can't reintroduce it without the suite turning red.
 */
import { describe, test, expect } from "bun:test";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else if (s.isFile() && p.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("ARV-29: no command may declare --api via requiredOption", () => {
  test("grep src/cli/commands for `requiredOption(\"--api`", () => {
    const files = walk(join(__dirname, "../../src/cli/commands"), []);
    const offenders: string[] = [];
    // Match `.requiredOption("--api …` and `.requiredOption('--api …` —
    // ignore the audit.ts comment that describes the historical bug.
    const re = /\.requiredOption\(\s*['"]--api\b/;
    for (const f of files) {
      const src = readFileSync(f, "utf-8");
      for (const [i, line] of src.split("\n").entries()) {
        if (re.test(line)) offenders.push(`${f}:${i + 1}: ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
