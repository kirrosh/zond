import { getDb } from "../../db/schema.ts";
import { listRuns, getRunById, getResultsByRunId } from "../../db/queries.ts";
import { printError } from "../output.ts";

export interface RunsOptions {
  runId?: number;
  limit?: number;
  dbPath?: string;
}

const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";

function useColor(): boolean {
  return process.stdout.isTTY ?? false;
}

function statusIcon(passed: number, failed: number): string {
  const color = useColor();
  if (failed === 0) return color ? `${GREEN}PASS${RESET}` : "PASS";
  return color ? `${RED}FAIL${RESET}` : "FAIL";
}

export function runsCommand(options: RunsOptions): number {
  const { runId, limit = 20, dbPath } = options;

  try {
    getDb(dbPath);
  } catch (err) {
    printError(`Failed to open database: ${(err as Error).message}`);
    return 2;
  }

  if (runId !== undefined) {
    return showRunDetail(runId);
  }
  return showRunList(limit);
}

function showRunList(limit: number): number {
  const runs = listRuns(limit);

  if (runs.length === 0) {
    console.log("No runs found.");
    return 0;
  }

  // Print table
  const header = "ID     STATUS  TOTAL  PASS  FAIL  ENV         DURATION  STARTED";
  console.log(header);
  console.log("-".repeat(header.length));

  for (const run of runs) {
    const status = statusIcon(run.passed, run.failed);
    const env = (run.environment ?? "-").slice(0, 10).padEnd(10);
    const duration = run.duration_ms != null ? `${run.duration_ms}ms` : "-";
    const started = run.started_at.slice(0, 19).replace("T", " ");
    console.log(
      `${String(run.id).padEnd(6)} ${status.padEnd(useColor() ? 14 : 6)}  ${String(run.total).padEnd(5)}  ${String(run.passed).padEnd(4)}  ${String(run.failed).padEnd(4)}  ${env}  ${duration.padEnd(8)}  ${started}`,
    );
  }

  return 0;
}

function showRunDetail(runId: number): number {
  const run = getRunById(runId);
  if (!run) {
    printError(`Run #${runId} not found`);
    return 1;
  }

  const color = useColor();

  console.log(`Run #${run.id}`);
  console.log(`  Started:     ${run.started_at}`);
  if (run.finished_at) console.log(`  Finished:    ${run.finished_at}`);
  if (run.environment) console.log(`  Environment: ${run.environment}`);
  if (run.duration_ms != null) console.log(`  Duration:    ${run.duration_ms}ms`);
  console.log(`  Total: ${run.total}  Passed: ${run.passed}  Failed: ${run.failed}  Skipped: ${run.skipped}`);

  const results = getResultsByRunId(runId);
  if (results.length === 0) {
    console.log("\nNo step results recorded.");
    return 0;
  }

  console.log("\nSteps:");
  for (const r of results) {
    let statusStr: string;
    if (r.status === "pass") {
      statusStr = color ? `${GREEN}PASS${RESET}` : "PASS";
    } else if (r.status === "fail" || r.status === "error") {
      statusStr = color ? `${RED}${r.status.toUpperCase()}${RESET}` : r.status.toUpperCase();
    } else {
      statusStr = color ? `${YELLOW}SKIP${RESET}` : "SKIP";
    }

    console.log(`  ${statusStr} ${r.test_name} (${r.duration_ms}ms)`);
    if (r.error_message) {
      console.log(`       ${color ? RED : ""}${r.error_message}${color ? RESET : ""}`);
    }
  }

  return 0;
}
