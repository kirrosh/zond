import { join, resolve as resolvePath } from "path";
import { existsSync } from "fs";
import { mkdir } from "fs/promises";
import {
  readOpenApiSpec,
  extractEndpoints,
  extractSecuritySchemes,
  scanCoveredEndpoints,
  filterUncoveredEndpoints,
  serializeSuite,
} from "../../core/generator/index.ts";
import {
  generateSuites,
  findUnresolvedVars,
  detectCrudGroupsWithDiagnostics,
} from "../../core/generator/suite-generator.ts";
import { filterByTag } from "../../core/generator/chunker.ts";
import { parse } from "../../core/parser/yaml-parser.ts";
import { printError, printSuccess } from "../output.ts";
import { jsonOk, jsonError, printJson } from "../json-envelope.ts";
import { getDb } from "../../db/schema.ts";
import { findCollectionByTestPath, updateCollection } from "../../db/queries.ts";
import { findWorkspaceRoot } from "../../core/workspace/root.ts";
import { recordGeneratedFiles, inferApiName, autoGenHeader, type RecordInput } from "../../core/workspace/manifest.ts";

/**
 * Walk up from outputDir looking for the API root — the first ancestor
 * that already contains `.api-catalog.yaml` (= a directory `zond add api`
 * has owned). Falls back to undefined when called from a non-conventional
 * layout, in which case the caller writes `.env.yaml` next to outputDir.
 *
 * The walk stops at filesystem root (or HOME). The optional baseUrl is
 * unused at the moment but kept on the signature so callers don't have
 * to recompute the conditions for "should we even bother" — when no
 * env vars are needed, the caller skips this entirely.
 */
function resolveApiRoot(outputDir: string, _baseUrl: string | undefined): string | undefined {
  const abs = resolvePath(outputDir);
  // 1) Walk up looking for an existing `.api-catalog.yaml` — strongest signal.
  let dir = abs;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, ".api-catalog.yaml"))) return dir;
    const parent = resolvePath(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  // 2) Fall back to the conventional layout: …/apis/<name>/[anything]/. The
  //    API root is the directory immediately under `apis/`. Picks up the
  //    case where the user runs `zond generate` before `zond add api`.
  const norm = abs.replace(/\\/g, "/");
  const m = norm.match(/^(.*?\/apis\/[^/]+)(?:\/|$)/);
  return m?.[1];
}

export interface GenerateOptions {
  specPath: string;
  output: string;
  tag?: string;
  uncoveredOnly?: boolean;
  /** TASK-139: dry-run that prints per-resource CRUD detection verdict and
   *  exits — no files written. Use to debug "why didn't generate emit a
   *  CRUD chain for resource X?" on real specs. */
  explain?: boolean;
  json?: boolean;
}

export async function generateCommand(options: GenerateOptions): Promise<number> {
  try {
    const doc = await readOpenApiSpec(options.specPath);
    const allEndpoints = extractEndpoints(doc);
    let endpoints = allEndpoints;
    const securitySchemes = extractSecuritySchemes(doc);

    // --explain short-circuits: print the CRUD detection table and exit.
    if (options.explain) {
      let scope = endpoints;
      if (options.tag) scope = filterByTag(scope, options.tag);
      const { groups, diagnostics } = detectCrudGroupsWithDiagnostics(scope);
      if (options.json) {
        printJson(jsonOk("generate", {
          mode: "explain",
          totalCandidates: diagnostics.length,
          chains: groups.length,
          diagnostics,
        }));
      } else {
        if (diagnostics.length === 0) {
          console.log("No POST endpoints in scope — nothing to evaluate.");
        } else {
          const chains = diagnostics.filter(d => d.verdict === "chain").length;
          console.log(`CRUD detection: ${chains}/${diagnostics.length} POST endpoints became chain candidates.\n`);
          const headers = ["resource", "post", "get/{id}", "put/patch", "delete", "list", "verdict", "reason"];
          const rows = diagnostics.map(d => [
            d.resource,
            d.postPath,
            d.hasGetById ? "✓" : "—",
            d.hasUpdate ? "✓" : "—",
            d.hasDelete ? "✓" : "—",
            d.hasList ? "✓" : "—",
            d.verdict,
            d.reason,
          ]);
          const widths = headers.map((h, i) =>
            Math.max(h.length, ...rows.map(r => r[i]!.length)),
          );
          const fmt = (cells: string[]) =>
            cells.map((c, i) => c.padEnd(widths[i]!)).join("  ");
          console.log(fmt(headers));
          console.log(widths.map(w => "─".repeat(w)).join("  "));
          for (const row of rows) console.log(fmt(row));
        }
      }
      return 0;
    }
    const baseUrl = ((doc as any).servers?.[0]?.url) as string | undefined;
    const warnings: string[] = [];

    // Filter to uncovered only
    if (options.uncoveredOnly) {
      const covered = await scanCoveredEndpoints(options.output);
      const before = endpoints.length;
      endpoints = filterUncoveredEndpoints(endpoints, covered);
      const coveredCount = before - endpoints.length;
      if (coveredCount > 0) {
        warnings.push(`Skipped ${coveredCount} already-covered endpoints`);
      }
    }

    // Filter by tag
    if (options.tag) {
      endpoints = filterByTag(endpoints, options.tag);
    }

    if (endpoints.length === 0) {
      if (options.json) {
        printJson(jsonOk("generate", { files: [], message: "No endpoints to generate tests for" }, warnings));
      } else {
        console.log("No endpoints to generate tests for.");
      }
      return 0;
    }

    // Generate suites
    const suites = generateSuites({ endpoints, securitySchemes, specPath: options.specPath });

    // Ensure output directory exists
    await mkdir(options.output, { recursive: true });

    // Write suite files
    const createdFiles: Array<{ file: string; suite: string; tests: number }> = [];
    const manifestEntries: RecordInput[] = [];
    const inferredApi = inferApiName(options.output);

    for (const suite of suites) {
      const yaml = serializeSuite(suite);
      const fileName = `${suite.fileStem ?? suite.name}.yaml`;
      const filePath = join(options.output, fileName);
      const header = autoGenHeader("zond generate", `zond generate --api <name> --output ${options.output}`);
      await Bun.write(filePath, header + yaml);
      createdFiles.push({ file: filePath, suite: suite.name, tests: suite.tests.length });
      manifestEntries.push({
        path: filePath,
        by: "zond generate",
        api: inferredApi,
        category: "tests",
      });
    }

    // TASK-157 (m-9 P1): generate no longer writes `.api-catalog.yaml` into
    // options.output. The API-level catalog at `apis/<name>/.api-catalog.yaml`
    // is the single source of truth — `zond add api` / `zond refresh-api`
    // emit it.

    // Sync DB collection spec reference if one is registered for this output directory
    try {
      getDb();
      const collection = findCollectionByTestPath(options.output);
      if (collection && collection.openapi_spec !== options.specPath) {
        updateCollection(collection.id, { openapi_spec: options.specPath });
        warnings.push(`Updated collection '${collection.name}' spec reference → ${options.specPath}`);
      }
    } catch {
      // DB unavailable — not fatal
    }

    // TASK-158 (m-9 P2): the API-level `apis/<name>/.env.yaml` is the only
    // source of truth for runtime variables. We never write a duplicate
    // `tests/.env.yaml` — it would silently override the API-level file via
    // deeper-scope precedence, wiping the user's auth_token / FK ids on
    // every `zond generate`. If the API-level file is missing, we create it
    // there; if it already exists, we leave it alone (re-running generate
    // never clobbers values the user filled in).
    const envTargetDir = resolveApiRoot(options.output, baseUrl) ?? options.output;
    const envPath = join(envTargetDir, ".env.yaml");
    const envFile = Bun.file(envPath);
    if (!(await envFile.exists())) {
      const unresolvedVars = new Set<string>();
      for (const suite of suites) {
        for (const v of findUnresolvedVars(suite)) unresolvedVars.add(v);
      }
      const lines: string[] = [];
      if (baseUrl) lines.push(`base_url: ${baseUrl}`);
      for (const v of [...unresolvedVars].sort()) {
        lines.push(`${v}: "" # TODO: fill in`);
      }
      if (lines.length > 0) {
        await mkdir(envTargetDir, { recursive: true });
        await Bun.write(envPath, lines.join("\n") + "\n");
        warnings.push(`Created ${envPath} with ${unresolvedVars.size} placeholder variable(s)`);
        manifestEntries.push({
          path: envPath,
          by: "zond generate",
          api: inferredApi,
          category: "env",
        });
      }
    }

    // Record everything we wrote into .zond/manifest.json (TASK-156).
    try {
      const ws = findWorkspaceRoot();
      if (!ws.fromFallback && manifestEntries.length > 0) {
        recordGeneratedFiles(ws.root, manifestEntries);
      }
    } catch {
      // Manifest is best-effort; never fail the generate command on it.
    }

    // Validate generated files
    const validationErrors: string[] = [];
    try {
      await parse(options.output);
    } catch (err) {
      validationErrors.push(err instanceof Error ? err.message : String(err));
    }

    if (validationErrors.length > 0) {
      warnings.push(`Validation warnings: ${validationErrors.join("; ")}`);
    }

    // Output
    const totalTests = createdFiles.reduce((sum, f) => sum + f.tests, 0);

    if (options.json) {
      printJson(jsonOk("generate", {
        files: createdFiles,
        totalSuites: suites.length,
        totalTests,
        outputDir: options.output,
      }, warnings));
    } else {
      printSuccess(`Generated ${suites.length} suite(s) with ${totalTests} test(s) in ${options.output}`);
      for (const f of createdFiles) {
        console.log(`  ${f.file} (${f.tests} tests)`);
      }
      if (warnings.length > 0) {
        for (const w of warnings) {
          console.log(`  ⚠ ${w}`);
        }
      }
      console.log("");
      console.log("Next steps:");
      console.log("  1. Fill apis/<name>/.env.yaml with auth_token, real FK ids, verified emails, valid enums");
      console.log("     (the fixture pack — without it, {{$randomString}} loses 5+ iterations to format-validation)");
      console.log("  2. zond run <output> --safe --json                              # smoke (GET-only)");
      console.log(`  3. zond run <output> --tag crud,setup --validate-schema --spec ${options.specPath} --json`);
      console.log("     (--validate-schema catches contract drift; recommended for every CRUD run)");
    }

    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (options.json) {
      printJson(jsonError("generate", [message]));
    } else {
      printError(message);
    }
    return 2;
  }
}

import type { Command } from "commander";
import { globalJson, resolveSpecArg } from "../resolve.ts";

export function registerGenerate(program: Command): void {
  program
    .command("generate [spec]")
    .description("Generate test suites from OpenAPI spec")
    .option("--api <name>", "Use the registered API's spec (apis/<name>/spec.json)")
    .option("--db <path>", "Path to SQLite database file")
    .option("--output <dir>", "Output directory for generated test files (required unless --explain)")
    .option("--tag <tag>", "Generate only for endpoints with this tag")
    .option("--uncovered-only", "Skip endpoints already covered by existing tests")
    .option("--explain", "Print the CRUD detection table (which resources became chain candidates and why) without writing files (TASK-139)")
    .action(async (specPos: string | undefined, opts, cmd: Command) => {
      const resolved = resolveSpecArg(specPos, opts.api, opts.db);
      if ("error" in resolved) { printError(resolved.error); process.exitCode = 2; return; }
      if (!opts.explain && !opts.output) {
        printError("--output <dir> is required (omit only when running with --explain).");
        process.exitCode = 2;
        return;
      }
      process.exitCode = await generateCommand({
        specPath: resolved.spec,
        output: opts.output ?? "",
        tag: opts.tag,
        uncoveredOnly: opts.uncoveredOnly === true,
        explain: opts.explain === true,
        json: globalJson(cmd),
      });
    });
}
