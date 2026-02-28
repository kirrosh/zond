import { tool } from "ai";
import { runTestsTool } from "./run-tests.ts";
import { validateTestsTool } from "./validate-tests.ts";
import { generateTestsTool } from "./generate-tests.ts";
import { queryResultsTool } from "./query-results.ts";
import { manageEnvironmentTool } from "./manage-environment.ts";
import { diagnoseFailureTool } from "./diagnose-failure.ts";
import { sendRequestTool } from "./send-request.ts";
import { exploreApiTool } from "./explore-api.ts";
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

  // In safe mode, wrap send_request to only allow GET
  const send_request = config.safeMode
    ? tool({
        description: sendRequestTool.description,
        inputSchema: sendRequestTool.inputSchema,
        execute: async (args, options) => {
          if (args.method !== "GET") {
            return { error: "Safe mode: only GET requests are allowed" };
          }
          return sendRequestTool.execute!(args, options);
        },
      })
    : sendRequestTool;

  return {
    run_tests,
    validate_tests: validateTestsTool,
    generate_tests: generateTestsTool,
    query_results: queryResultsTool,
    manage_environment: manageEnvironmentTool,
    diagnose_failure: diagnoseFailureTool,
    send_request,
    explore_api: exploreApiTool,
  };
}

export { runTestsTool, validateTestsTool, generateTestsTool, queryResultsTool, manageEnvironmentTool, diagnoseFailureTool, sendRequestTool, exploreApiTool };
