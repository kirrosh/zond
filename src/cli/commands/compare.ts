import { getDb } from "../../db/schema.ts";
import { getRunById, getResultsByRunId } from "../../db/queries.ts";
import { printError } from "../output.ts";

const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const BOLD = "\x1b[1m";

function useColor(): boolean {
  return process.stdout.isTTY ?? false;
}

export interface CompareOptions {
  runA: number;
  runB: number;
  dbPath?: string;
}

export async function compareCommand(options: CompareOptions): Promise<number> {
  const { runA, runB, dbPath } = options;

  try {
    getDb(dbPath);

    const runARecord = getRunById(runA);
    const runBRecord = getRunById(runB);

    if (!runARecord) {
      printError(`Run #${runA} not found`);
      return 2;
    }
    if (!runBRecord) {
      printError(`Run #${runB} not found`);
      return 2;
    }

    const resultsA = getResultsByRunId(runA);
    const resultsB = getResultsByRunId(runB);

    // Build lookup maps: "suite_name::test_name" → status
    const mapA = new Map<string, string>();
    const mapB = new Map<string, string>();

    for (const r of resultsA) {
      mapA.set(`${r.suite_name}::${r.test_name}`, r.status);
    }
    for (const r of resultsB) {
      mapB.set(`${r.suite_name}::${r.test_name}`, r.status);
    }

    const regressions: Array<{ suite: string; test: string; before: string; after: string }> = [];
    const fixes: Array<{ suite: string; test: string; before: string; after: string }> = [];
    const unchanged: number[] = [];
    let newTests = 0;
    let removedTests = 0;

    // Check all keys from B (current run)
    for (const [key, statusB] of mapB) {
      const statusA = mapA.get(key);
      if (statusA === undefined) {
        newTests++;
        continue;
      }
      const wasPass = statusA === "pass";
      const isPass = statusB === "pass";
      const wasFail = statusA === "fail" || statusA === "error";
      const isFail = statusB === "fail" || statusB === "error";

      const [suite, test] = key.split("::") as [string, string];

      if (wasPass && isFail) {
        regressions.push({ suite, test, before: statusA, after: statusB });
      } else if (wasFail && isPass) {
        fixes.push({ suite, test, before: statusA, after: statusB });
      } else {
        unchanged.push(1);
      }
    }

    // Count removed tests
    for (const key of mapA.keys()) {
      if (!mapB.has(key)) removedTests++;
    }

    const color = useColor();

    // Header
    console.log(`\nComparing run #${runA} (${runARecord.started_at.slice(0, 19)}) → run #${runB} (${runBRecord.started_at.slice(0, 19)})\n`);

    // Summary line
    const parts = [
      `${color ? BOLD : ""}${regressions.length} regressions${color ? RESET : ""}`,
      `${fixes.length} fixes`,
      `${unchanged.length} unchanged`,
    ];
    if (newTests > 0) parts.push(`${newTests} new`);
    if (removedTests > 0) parts.push(`${removedTests} removed`);
    console.log(parts.join("  |  ") + "\n");

    // Regressions
    if (regressions.length > 0) {
      console.log(`${color ? RED + BOLD : ""}Regressions (pass → fail):${color ? RESET : ""}`);
      for (const r of regressions) {
        console.log(`  ${color ? RED : ""}✗${color ? RESET : ""} [${r.suite}] ${r.test}  (${r.before} → ${r.after})`);
      }
      console.log("");
    }

    // Fixes
    if (fixes.length > 0) {
      console.log(`${color ? GREEN : ""}Fixes (fail → pass):${color ? RESET : ""}`);
      for (const f of fixes) {
        console.log(`  ${color ? GREEN : ""}✓${color ? RESET : ""} [${f.suite}] ${f.test}  (${f.before} → ${f.after})`);
      }
      console.log("");
    }

    if (regressions.length === 0 && fixes.length === 0) {
      console.log(`${color ? GREEN : ""}No regressions detected.${color ? RESET : ""}`);
    }

    return regressions.length > 0 ? 1 : 0;
  } catch (err) {
    printError(err instanceof Error ? err.message : String(err));
    return 2;
  }
}
