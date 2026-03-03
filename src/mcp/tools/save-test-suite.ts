import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { validateSuite } from "../../core/parser/schema.ts";
import { join, dirname } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import YAML from "yaml";

export function registerSaveTestSuiteTool(server: McpServer, dbPath?: string) {
  server.registerTool("save_test_suite", {
    description: "Save a YAML test suite file with validation. Parses and validates the YAML content " +
      "before writing. Returns structured errors if validation fails so you can fix and retry. " +
      "Use after generating test content with generate_tests_guide.",
    inputSchema: {
      filePath: z.string().describe("Path for saving the YAML test file (e.g. apis/petstore/tests/pets-crud.yaml)"),
      content: z.string().describe("YAML content of the test suite"),
      overwrite: z.optional(z.boolean()).describe("Overwrite existing file (default: false)"),
    },
  }, async ({ filePath, content, overwrite }) => {
    try {
      // Parse YAML
      let parsed: unknown;
      try {
        parsed = YAML.parse(content);
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({
            saved: false,
            error: `YAML parse error: ${(err as Error).message}`,
            hint: "Check YAML syntax — indentation, colons, and quoting",
          }, null, 2) }],
          isError: true,
        };
      }

      // Validate against test suite schema
      try {
        validateSuite(parsed);
      } catch (err) {
        const message = (err as Error).message;
        // Extract Zod error details
        let hint = "Check the test suite structure matches the expected format";
        if (message.includes("status")) {
          hint = "Status codes must be numbers, not strings (e.g. status: 200, not status: \"200\")";
        } else if (message.includes("exists")) {
          hint = "exists must be boolean true/false, not string \"true\"/\"false\"";
        } else if (message.includes("tests")) {
          hint = "Suite must have a 'tests' array with at least one test step";
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify({
            saved: false,
            error: `Validation: ${message}`,
            hint,
          }, null, 2) }],
          isError: true,
        };
      }

      // Detect hardcoded credentials — long opaque strings in auth headers
      const credentialPattern = /Authorization\s*:\s*["']?(Basic|Bearer)\s+([A-Za-z0-9+/=_\-]{20,})["']?/g;
      const credMatches = [...content.matchAll(credentialPattern)];
      const suspiciousCredentials = credMatches.filter(m => {
        const value = m[2]!;
        // Allow {{variable}} references — flag only literal tokens
        return !value.startsWith("{{") && !value.endsWith("}}");
      });
      if (suspiciousCredentials.length > 0) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({
            saved: false,
            error: "Hardcoded credentials detected in Authorization header(s)",
            hint: "Never put literal API keys or tokens in YAML files. Store them in the environment instead: use manage_environment(action: \"set\", name: \"default\", collectionName: \"...\", variables: {\"api_key\": \"...\"}) and reference as {{api_key}} in headers.",
            detected: suspiciousCredentials.map(m => `${m[1]} <redacted>`),
          }, null, 2) }],
          isError: true,
        };
      }

      // Resolve path
      const resolvedPath = filePath.startsWith("/") || /^[a-zA-Z]:/.test(filePath)
        ? filePath
        : join(process.cwd(), filePath);

      // Check existing file
      if (!overwrite && existsSync(resolvedPath)) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({
            saved: false,
            error: `File already exists: ${resolvedPath}`,
            hint: "Use overwrite: true to replace the existing file",
          }, null, 2) }],
          isError: true,
        };
      }

      // Create directories
      const dir = dirname(resolvedPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }

      // Write original YAML content (preserve formatting/comments)
      await Bun.write(resolvedPath, content);

      // Extract summary info
      const suite = parsed as Record<string, unknown>;
      const tests = (suite.tests as unknown[]) ?? [];

      const result: Record<string, unknown> = {
        saved: true,
        filePath: resolvedPath,
        suite: {
          name: suite.name,
          tests: tests.length,
          base_url: suite.base_url ?? null,
        },
      };

      // CI hint
      result.hint = "After tests are ready, ask the user if they want to set up CI/CD with ci_init to run tests automatically on push.";

      // Attempt to compute coverage hint
      try {
        const testDir = dirname(resolvedPath);
        const { findCollectionByTestPath } = await import("../../db/queries.ts");
        const { getDb } = await import("../../db/schema.ts");
        getDb(dbPath);
        const collection = findCollectionByTestPath(testDir);
        if (collection?.openapi_spec) {
          const { readOpenApiSpec, extractEndpoints } = await import("../../core/generator/openapi-reader.ts");
          const { scanCoveredEndpoints, filterUncoveredEndpoints } = await import("../../core/generator/coverage-scanner.ts");

          const doc = await readOpenApiSpec(collection.openapi_spec);
          const allEndpoints = extractEndpoints(doc);
          const covered = await scanCoveredEndpoints(testDir);
          const uncovered = filterUncoveredEndpoints(allEndpoints, covered);

          const total = allEndpoints.length;
          const coveredCount = total - uncovered.length;
          const percentage = total > 0 ? Math.round((coveredCount / total) * 100) : 0;

          const coverage: Record<string, unknown> = { percentage, covered: coveredCount, total, uncoveredCount: uncovered.length };
          if (percentage < 80 && uncovered.length > 0) {
            coverage.suggestion = `Use generate_missing_tests to cover ${uncovered.length} remaining endpoint${uncovered.length > 1 ? "s" : ""}`;
          }
          result.coverage = coverage;
        }
      } catch { /* silently skip coverage if unavailable */ }

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify({
          saved: false,
          error: (err as Error).message,
        }, null, 2) }],
        isError: true,
      };
    }
  });
}
