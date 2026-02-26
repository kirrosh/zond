import { getDb } from "./src/db/schema.ts";
import { createRun, finalizeRun, saveResults } from "./src/db/queries.ts";
import type { TestRunResult } from "./src/core/runner/types.ts";

getDb();

function makeRun(dayOffset: number, passRate: number): TestRunResult[] {
  const d = new Date();
  d.setDate(d.getDate() - dayOffset);
  const total = 10;
  const passed = Math.round(total * passRate);
  const failed = total - passed;

  const steps = [];
  for (let i = 0; i < total; i++) {
    const status = i < passed ? "pass" : "fail";
    steps.push({
      name: `Test step ${i + 1}`,
      status: status as any,
      duration_ms: 50 + Math.round(Math.random() * 500),
      request: { method: "GET", url: `http://api.example.com/endpoint-${i}`, headers: {} },
      response: { status: status === "pass" ? 200 : 500, headers: {}, body: "{}", duration_ms: 50 + Math.round(Math.random() * 500) },
      assertions: [{ field: "status", rule: `equals ${status === "pass" ? 200 : 204}`, passed: status === "pass", actual: status === "pass" ? 200 : 500, expected: status === "pass" ? 200 : 204 }],
      captures: {},
    });
  }

  return [{
    suite_name: dayOffset % 2 === 0 ? "Users API" : "Payments API",
    started_at: d.toISOString(),
    finished_at: new Date(d.getTime() + 1500).toISOString(),
    total,
    passed,
    failed,
    skipped: 0,
    steps,
  }];
}

// Create 8 runs with varying pass rates
const rates = [1.0, 0.9, 0.8, 1.0, 0.7, 1.0, 0.9, 0.6];
for (let i = 0; i < rates.length; i++) {
  const results = makeRun(rates.length - i, rates[i]!);
  const runId = createRun({
    started_at: results[0]!.started_at,
    environment: i % 2 === 0 ? "staging" : "production",
    trigger: "manual",
  });
  finalizeRun(runId, results);
  saveResults(runId, results);
}

console.log("Seeded 8 demo runs into apitool.db");
