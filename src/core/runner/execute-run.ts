import { parse } from "../parser/yaml-parser.ts";
import { loadEnvironment } from "../parser/variables.ts";
import { runSuite } from "./executor.ts";
import { getDb } from "../../db/schema.ts";
import { createRun, finalizeRun, saveResults, findCollectionByTestPath } from "../../db/queries.ts";
import { dirname, resolve } from "path";
import { stat } from "node:fs/promises";
import type { TestRunResult } from "./types.ts";

export interface ExecuteRunOptions {
  testPath: string;
  envName?: string;
  trigger?: string;  // "cli" | "webui" | "mcp"
  dbPath?: string;
  safe?: boolean;
}

export interface ExecuteRunResult {
  runId: number;
  results: TestRunResult[];
}

export async function executeRun(options: ExecuteRunOptions): Promise<ExecuteRunResult> {
  const { testPath, envName, trigger = "cli", dbPath, safe } = options;

  let suites = await parse(testPath);
  if (suites.length === 0) {
    throw new Error("No test files found");
  }

  // Safe mode: filter to GET-only tests
  if (safe) {
    for (const suite of suites) {
      suite.tests = suite.tests.filter(t => t.method === "GET");
    }
    suites = suites.filter(s => s.tests.length > 0);
    if (suites.length === 0) {
      throw new Error("No GET tests found. Nothing to run in safe mode.");
    }
  }

  const fileStat = await stat(testPath).catch(() => null);
  const envDir = fileStat?.isDirectory() ? testPath : dirname(testPath);
  const env = await loadEnvironment(envName, envDir);
  const results = await Promise.all(suites.map((s) => runSuite(s, env)));

  getDb(dbPath);
  const resolvedPath = resolve(testPath);
  const collection = findCollectionByTestPath(resolvedPath)
    ?? (fileStat?.isFile() ? findCollectionByTestPath(resolve(dirname(testPath))) : null);
  const runId = createRun({
    started_at: results[0]?.started_at ?? new Date().toISOString(),
    environment: envName,
    trigger,
    collection_id: collection?.id,
  });
  finalizeRun(runId, results);
  saveResults(runId, results);

  return { runId, results };
}
