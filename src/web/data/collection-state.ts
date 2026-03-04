/**
 * Unified collection state builder for Web UI.
 * Aggregates spec endpoints, disk suites, coverage, run results, warnings, env diagnostics.
 */

import type { CollectionRecord, RunRecord, StoredStepResult } from "../../db/queries.ts";
import { listRunsByCollection, getResultsByRunId, getRunById } from "../../db/queries.ts";
import type { EndpointWarning } from "../../core/generator/endpoint-warnings.ts";
import { envHint, statusHint, classifyFailure, computeSharedEnvIssue } from "../../core/diagnostics/failure-hints.ts";
import { join, basename } from "node:path";

// ── Types ──

export interface CoveringStep {
  suiteName: string;
  file: string;            // relative filename (e.g. "auth-login.yaml")
  stepName: string;
  status: "pass" | "fail" | "error" | "skip" | null; // null = not run
  responseStatus?: number;
  durationMs?: number;
  hint?: string;           // failure hint
  assertions?: { field: string; rule: string; passed: boolean; actual?: unknown; expected?: unknown }[];
}

export interface EndpointViewState {
  method: string;
  path: string;
  summary?: string;
  deprecated: boolean;
  hasCoverage: boolean;
  runStatus: "passing" | "api_error" | "test_failed" | "not_run" | "no_tests";
  warnings: string[];
  coveringFiles: string[];
  coveringSteps: CoveringStep[];
}

export interface SuiteViewState {
  name: string;
  description?: string;
  tags: string[];
  stepCount: number;
  filePath: string;
  status: "passed" | "failed" | "not_run" | "parse_error";
  runResult?: { passed: number; failed: number; skipped: number };
  parseError?: string;
}

export interface CollectionState {
  collection: CollectionRecord;
  endpoints: EndpointViewState[];
  totalEndpoints: number;
  coveragePct: number;
  coveredCount: number;
  suites: SuiteViewState[];
  latestRun: RunRecord | null;
  latestRunResults: StoredStepResult[];
  envAlert: string | null;
  warnings: EndpointWarning[];
  // Run stats
  runPassed: number;
  runFailed: number;
  runSkipped: number;
  runTotal: number;
  runDurationMs: number | null;
}

// ── Cache ──

interface CacheEntry {
  state: CollectionState;
  timestamp: number;
}

const cache = new Map<number, CacheEntry>();
const CACHE_TTL_MS = 30_000;

export function invalidateCollectionCache(collectionId: number): void {
  cache.delete(collectionId);
}

// ── Builder ──

export async function buildCollectionState(collection: CollectionRecord): Promise<CollectionState> {
  const cached = cache.get(collection.id);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return cached.state;
  }

  // Load spec endpoints
  let specEndpoints: import("../../core/generator/types.ts").EndpointInfo[] = [];
  let warnings: EndpointWarning[] = [];
  if (collection.openapi_spec) {
    try {
      const { readOpenApiSpec, extractEndpoints } = await import("../../core/generator/openapi-reader.ts");
      const { analyzeEndpoints } = await import("../../core/generator/endpoint-warnings.ts");
      const doc = await readOpenApiSpec(collection.openapi_spec);
      specEndpoints = extractEndpoints(doc);
      warnings = analyzeEndpoints(specEndpoints);
    } catch { /* spec unavailable */ }
  }

  // Scan coverage from disk
  const { scanCoveredEndpoints } = await import("../../core/generator/coverage-scanner.ts");
  const { specPathToRegex, normalizePath } = await import("../../core/generator/coverage-scanner.ts");
  let coveredEndpoints: import("../../core/generator/coverage-scanner.ts").CoveredEndpoint[] = [];
  try {
    coveredEndpoints = await scanCoveredEndpoints(collection.test_path);
  } catch { /* no tests on disk */ }

  // Parse suites from disk
  const { parseDirectorySafe } = await import("../../core/parser/yaml-parser.ts");
  let diskSuites: import("../../core/parser/yaml-parser.ts").ParseDirectoryResult = { suites: [], errors: [] };
  try {
    diskSuites = await parseDirectorySafe(collection.test_path);
  } catch { /* test dir missing */ }

  // Get latest run
  const runs = listRunsByCollection(collection.id, 1, 0);
  const latestRun = runs.length > 0 ? (getRunById(runs[0]!.id) ?? null) : null;
  const latestRunResults = latestRun ? getResultsByRunId(latestRun.id) : [];

  // Build result maps: suite_name -> step statuses
  const suiteResultMap = new Map<string, StoredStepResult[]>();
  for (const r of latestRunResults) {
    const list = suiteResultMap.get(r.suite_name) ?? [];
    list.push(r);
    suiteResultMap.set(r.suite_name, list);
  }

  // Build endpoint -> run status map
  // key: "METHOD /path" from results
  const endpointRunStatusMap = new Map<string, "passing" | "api_error" | "test_failed">();
  for (const r of latestRunResults) {
    if (r.request_method && r.request_url) {
      // Extract path from URL
      let urlPath: string;
      try {
        const u = new URL(r.request_url);
        urlPath = u.pathname;
      } catch {
        urlPath = r.request_url;
      }
      const key = `${r.request_method} ${normalizePath(urlPath)}`;
      const current = endpointRunStatusMap.get(key);
      if (r.status === "fail" || r.status === "error") {
        const ft = classifyFailure(r.status, r.response_status);
        endpointRunStatusMap.set(key, ft === "api_error" ? "api_error" : "test_failed");
      } else if (r.status === "pass" && current !== "test_failed" && current !== "api_error") {
        endpointRunStatusMap.set(key, "passing");
      }
    }
  }

  // Build endpoint view states
  const warningsMap = new Map<string, string[]>();
  for (const w of warnings) {
    warningsMap.set(`${w.method} ${w.path}`, w.warnings);
  }

  // Build map: normalized "METHOD /path" -> list of StoredStepResult
  const resultsByEndpoint = new Map<string, StoredStepResult[]>();
  for (const r of latestRunResults) {
    if (r.request_method && r.request_url) {
      let urlPath: string;
      try { urlPath = new URL(r.request_url).pathname; } catch { urlPath = r.request_url; }
      const key = `${r.request_method} ${normalizePath(urlPath)}`;
      const list = resultsByEndpoint.get(key) ?? [];
      list.push(r);
      resultsByEndpoint.set(key, list);
    }
  }

  // Map suite name -> file basename for display
  const suiteNameToFile = new Map<string, string>();
  for (const s of diskSuites.suites) {
    suiteNameToFile.set(s.name, basename(s.filePath ?? s.name));
  }

  // Env file path for hints
  const envFilePath = collection.base_dir
    ? join(collection.base_dir, ".env.yaml").replace(/\\/g, "/")
    : undefined;

  const endpoints: EndpointViewState[] = specEndpoints.map(ep => {
    const specRegex = specPathToRegex(ep.path);
    const covering = coveredEndpoints.filter(
      c => c.method === ep.method && specRegex.test(normalizePath(c.path)),
    );
    const hasCoverage = covering.length > 0;

    // Determine run status
    let runStatus: EndpointViewState["runStatus"] = "no_tests";
    if (hasCoverage) {
      runStatus = "not_run";
      for (const [key, status] of endpointRunStatusMap) {
        const [method, path] = [key.split(" ")[0], key.split(" ").slice(1).join(" ")];
        if (method === ep.method && specRegex.test(path!)) {
          runStatus = status;
          break;
        }
      }
    }

    // Build covering steps from run results
    const coveringSteps: CoveringStep[] = [];
    for (const [key, results] of resultsByEndpoint) {
      const [method, path] = [key.split(" ")[0], key.split(" ").slice(1).join(" ")];
      if (method === ep.method && specRegex.test(path!)) {
        for (const r of results) {
          const hint = (r.status === "fail" || r.status === "error")
            ? (envHint(r.request_url, r.error_message, envFilePath) ?? statusHint(r.response_status) ?? undefined)
            : undefined;
          coveringSteps.push({
            suiteName: r.suite_name,
            file: suiteNameToFile.get(r.suite_name) ?? r.suite_name,
            stepName: r.test_name,
            status: r.status as CoveringStep["status"],
            responseStatus: r.response_status ?? undefined,
            durationMs: r.duration_ms ?? undefined,
            hint,
            assertions: Array.isArray(r.assertions) ? r.assertions : undefined,
          });
        }
      }
    }

    return {
      method: ep.method,
      path: ep.path,
      summary: ep.summary,
      deprecated: ep.deprecated ?? false,
      hasCoverage,
      runStatus,
      warnings: warningsMap.get(`${ep.method} ${ep.path}`) ?? [],
      coveringFiles: covering.map(c => c.file),
      coveringSteps,
    };
  });

  // Coverage stats
  const totalEndpoints = endpoints.length;
  const coveredCount = endpoints.filter(e => e.hasCoverage).length;
  const coveragePct = totalEndpoints > 0 ? Math.round((coveredCount / totalEndpoints) * 100) : 0;

  // Build suite view states
  const suites: SuiteViewState[] = diskSuites.suites.map(s => {
    const results = suiteResultMap.get(s.name);
    let status: SuiteViewState["status"] = "not_run";
    let runResult: SuiteViewState["runResult"] | undefined;

    if (results) {
      const passed = results.filter(r => r.status === "pass").length;
      const failed = results.filter(r => r.status === "fail" || r.status === "error").length;
      const skipped = results.filter(r => r.status === "skip").length;
      runResult = { passed, failed, skipped };
      status = failed > 0 ? "failed" : "passed";
    }

    return {
      name: s.name,
      description: s.description,
      tags: s.tags ?? [],
      stepCount: s.tests.length,
      filePath: s.filePath ?? "",
      status,
      runResult,
    };
  });

  // Add parse errors as suites
  for (const err of diskSuites.errors) {
    suites.push({
      name: err.file,
      tags: [],
      stepCount: 0,
      filePath: err.file,
      status: "parse_error",
      parseError: err.error,
    });
  }

  // Env diagnostics
  let envAlert: string | null = null;
  const failedResults = latestRunResults.filter(r => r.status === "fail" || r.status === "error");
  if (failedResults.length > 0) {
    const envFilePath = collection.base_dir
      ? join(collection.base_dir, ".env.yaml").replace(/\\/g, "/")
      : undefined;

    const failuresWithHints = failedResults.map(r => ({
      hint: envHint(r.request_url, r.error_message, envFilePath) ?? undefined,
    }));
    envAlert = computeSharedEnvIssue(failuresWithHints, envFilePath);
  }

  // Run stats
  const runPassed = latestRun?.passed ?? 0;
  const runFailed = latestRun?.failed ?? 0;
  const runSkipped = latestRun?.skipped ?? 0;
  const runTotal = latestRun?.total ?? 0;
  const runDurationMs = latestRun?.duration_ms ?? null;

  const state: CollectionState = {
    collection,
    endpoints,
    totalEndpoints,
    coveragePct,
    coveredCount,
    suites,
    latestRun,
    latestRunResults,
    envAlert,
    warnings,
    runPassed,
    runFailed,
    runSkipped,
    runTotal,
    runDurationMs,
  };

  cache.set(collection.id, { state, timestamp: Date.now() });
  return state;
}
