import { tool } from "ai";
import { runTestsTool } from "./run-tests.ts";
import { validateTestsTool } from "./validate-tests.ts";
import { generateTestsTool } from "./generate-tests.ts";
import { queryResultsTool } from "./query-results.ts";
import { manageEnvironmentTool } from "./manage-environment.ts";
import { diagnoseFailureTool } from "./diagnose-failure.ts";
import type { AgentConfig } from "../types.ts";

export function buildAgentTools(config: AgentConfig) {
  // In safe mode, wrap run_tests to force safe=true
  const run_tests = config.safeMode
    ? tool({
        description: runTestsTool.description,
        inputSchema: runTestsTool.inputSchema,
        execute: async (args, options) => {
          return runTestsTool.execute!({ ...args, safe: true }, options);
        },
      })
    : runTestsTool;

  return {
    run_tests,
    validate_tests: validateTestsTool,
    generate_tests: generateTestsTool,
    query_results: queryResultsTool,
    manage_environment: manageEnvironmentTool,
    diagnose_failure: diagnoseFailureTool,
  };
}

export { runTestsTool, validateTestsTool, generateTestsTool, queryResultsTool, manageEnvironmentTool, diagnoseFailureTool };
