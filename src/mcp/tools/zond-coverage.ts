import { z } from "zod";

import {
  readOpenApiSpec,
  extractEndpoints,
  scanCoveredEndpoints,
  filterUncoveredEndpoints,
} from "../../core/generator/index.ts";
import type { McpTool } from "./types.ts";

const inputSchema = z.object({
  specPath: z.string().min(1),
  testsDir: z.string().min(1),
});

type Input = z.infer<typeof inputSchema>;

export const zondCoverageTool: McpTool<Input> = {
  name: "zond_coverage",
  description: "Compute API test coverage for an OpenAPI spec — counts and per-endpoint covered/uncovered lists.",
  inputSchema,
  handler: async (input) => {
    const doc = await readOpenApiSpec(input.specPath);
    const allEndpoints = extractEndpoints(doc);
    const covered = await scanCoveredEndpoints(input.testsDir);
    const uncovered = filterUncoveredEndpoints(allEndpoints, covered);
    const total = allEndpoints.length;
    const coveredCount = total - uncovered.length;
    const percentage = total === 0 ? 0 : Math.round((coveredCount / total) * 100);

    return {
      covered: coveredCount,
      uncovered: uncovered.length,
      total,
      percentage,
      coveredEndpoints: allEndpoints
        .filter((ep) => !uncovered.includes(ep))
        .map((ep) => `${ep.method} ${ep.path}`),
      uncoveredEndpoints: uncovered.map((ep) => `${ep.method} ${ep.path}`),
    };
  },
};
