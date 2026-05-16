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
import { generateFromSchema, classifyFieldSource } from "../../core/generator/data-factory.ts";
import { filterByTag, collectTags } from "../../core/generator/chunker.ts";
import { compileOperationFilter } from "../../core/selectors/operation-filter.ts";
import { parse } from "../../core/parser/yaml-parser.ts";
import { loadEnvironment } from "../../core/parser/variables.ts";
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
  /** When true, deprecated endpoints are included in generation. Default
   *  (false) filters them out and surfaces the count as a warning so users
   *  can distinguish "deprecated by design" from "accidentally dropped". */
  includeDeprecated?: boolean;
  /** TASK-139: dry-run that prints per-resource CRUD detection verdict and
   *  exits — no files written. Use to debug "why didn't generate emit a
   *  CRUD chain for resource X?" on real specs. */
  explain?: boolean;
  /** TASK-219: accepted but currently a no-op — `zond generate` already
   *  overwrites unconditionally. Kept on the CLI so agents passing
   *  `--force` / `--overwrite` don't see "unknown option" and bail. A
   *  future fix will gate sha-mismatched user edits behind this flag. */
  force?: boolean;
  json?: boolean;
  /** ARV-9 unified filter: path:<regex> / method:<csv> / tag:<csv> /
   *  operation-id:<regex>. Multiple flags combine with OR; --exclude
   *  always removes. Stacks with --tag for back-compat. */
  include?: string[];
  exclude?: string[];
  /** ARV-212 (R13/F16, R14): the explicit --api name. Lets generate read
   *  apis/<name>/.env.yaml directly even when --output points outside the
   *  apis/<name>/ tree (e.g. /tmp/<scratch>), where resolveApiRoot /
   *  inferApiName cannot recover the name from the path. */
  apiName?: string;
  /** ARV-212: explicit override for apis/<name>/ root. Caller pre-resolved
   *  it through the DB (base_dir column) for the case where the API was
   *  registered in a non-standard layout. */
  apiDir?: string;
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
      // Per-field body sources (TASK-269) — same scope as the table below.
      const bodyFieldSources = scope
        .filter(ep => ep.requestBodySchema && (ep.requestBodySchema as any).type === "object" &&
                      (ep.requestBodySchema as any).properties)
        .map(ep => {
          const props = (ep.requestBodySchema as any).properties as Record<string, any>;
          const fields = Object.entries(props)
            .filter(([k, s]) => !(s.readOnly === true) && k !== "id")
            .map(([key, s]) => ({
              field: key,
              type: Array.isArray(s.type)
                ? (s.type as string[]).find(x => x !== "null") ?? "any"
                : (s.type ?? "any"),
              value: generateFromSchema(s, key),
              source: classifyFieldSource(s, key),
            }));
          return { method: ep.method.toUpperCase(), path: ep.path, fields };
        })
        .filter(e => e.fields.length > 0);

      if (options.json) {
        printJson(jsonOk("generate", {
          mode: "explain",
          totalCandidates: diagnostics.length,
          chains: groups.length,
          diagnostics,
          bodyFieldSources,
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

        // TASK-269: per-field provenance for endpoints carrying a request
        // body. Helps debug "why did the API 400 on field X?" without
        // re-running with --json and inspecting the generated suite.
        if (bodyFieldSources.length > 0) {
          console.log("");
          console.log("Body field sources:");
          for (const ep of bodyFieldSources) {
            console.log(`  ${ep.method} ${ep.path}`);
            const fHeaders = ["field", "type", "value", "source"];
            const rows2 = ep.fields.map(f => [
              f.field,
              String(f.type),
              typeof f.value === "string" ? f.value : JSON.stringify(f.value),
              `[${f.source}]`,
            ]);
            const fAll = [fHeaders, ...rows2];
            const fWidths = fHeaders.map((h, i) =>
              Math.max(h.length, ...fAll.map(r => r[i]!.length)),
            );
            const ffmt = (cells: string[]) =>
              cells.map((c, i) => c.padEnd(fWidths[i]!)).join("  ");
            console.log("    " + ffmt(fHeaders));
            console.log("    " + fWidths.map(w => "─".repeat(w)).join("  "));
            for (const r of rows2) console.log("    " + ffmt(r));
          }
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

    // ARV-9: unified --include/--exclude filter (applied before --tag so
    // --tag stays a thin alias when both are passed; usually only one is).
    if (options.include?.length || options.exclude?.length) {
      const compiled = compileOperationFilter({ includes: options.include, excludes: options.exclude });
      if (compiled.errors.length > 0) {
        const message = compiled.errors.join("\n");
        if (options.json) printJson(jsonOk("generate", { files: [], message }, compiled.errors));
        else printError(message);
        return 2;
      }
      endpoints = endpoints.filter(compiled.filter);
    }

    // Filter by tag
    let tagDiagnostic: string | undefined;
    if (options.tag) {
      const beforeTag = endpoints;
      endpoints = filterByTag(endpoints, options.tag);
      // TASK-232: when --tag matches nothing, show the available tags so the
      // user can tell "typo" apart from "spec really has no endpoints here".
      // Cheap nearest-match: pick the first tag containing or contained-by the
      // requested string (case-insensitive); covers "Members" → "Member".
      if (endpoints.length === 0 && beforeTag.length > 0) {
        const available = collectTags(beforeTag);
        const wanted = options.tag.trim().toLowerCase();
        const closest = available.find(t => {
          const tl = t.toLowerCase();
          return tl.includes(wanted) || wanted.includes(tl);
        });
        const hint = closest ? ` (did you mean ${closest}?)` : "";
        const list = available.length > 0 ? available.join(", ") : "(none)";
        tagDiagnostic = `No endpoints with tag '${options.tag}'${hint}. Available tags: ${list}`;
      }
    }

    if (endpoints.length === 0) {
      const message = tagDiagnostic ?? "No endpoints to generate tests for";
      if (options.json) {
        printJson(jsonOk("generate", { files: [], message }, warnings));
      } else {
        console.log(`${message}.`);
      }
      return 0;
    }

    // Count deprecated endpoints before generateSuites filters them — we
    // surface the count as a warning so deprecated-by-design and
    // accidentally-dropped look different in stdout.
    const deprecatedSkipped = options.includeDeprecated
      ? []
      : endpoints.filter(ep => ep.deprecated).map(ep => `${ep.method} ${ep.path}`);

    // ARV-212 (R13/F16, R14): peek at .env.yaml *before* generating suites so
    // we can pass `defaultAuthVar` into generateSuites when the spec has no
    // securitySchemes but the workspace is wired for Bearer auth (the
    // ARV-201 seed in setup-api.ts). Without this, GitHub-style suites go
    // unauth and brick on the first rate-limited 60 requests.
    //
    // R14 fix: do NOT rely on resolveApiRoot(options.output) — when the
    // user passes --output to a scratch directory outside apis/<name>/
    // (e.g. /tmp/foo), the resolver returns undefined and we fall back to
    // the output dir, which has no .env.yaml. Prefer the explicit --api
    // name to construct apis/<name>/ inside the workspace.
    const envForWarnings: Record<string, unknown> = {};
    try {
      let envDir: string | undefined = options.apiDir;
      if (!envDir && options.apiName) {
        const ws = findWorkspaceRoot();
        envDir = resolvePath(ws.root, "apis", options.apiName);
      }
      if (!envDir) envDir = resolveApiRoot(options.output, baseUrl) ?? options.output;
      Object.assign(envForWarnings, await loadEnvironment(undefined, envDir));
    } catch { /* env load failures stay silent — original behaviour for missing files */ }

    let defaultAuthVar: string | undefined;
    if (securitySchemes.length === 0 && "auth_token" in envForWarnings) {
      // Presence-not-value: an empty .secrets.yaml.auth_token resolves to ""
      // here, but the .env.yaml wiring is what matters. Once the user fills
      // .secrets.yaml the generated suite picks up the Bearer header without
      // a regenerate.
      defaultAuthVar = "auth_token";
    }

    // Generate suites
    const suites = generateSuites({
      endpoints,
      securitySchemes,
      specPath: options.specPath,
      includeDeprecated: options.includeDeprecated,
      defaultAuthVar,
    });

    const missingPathParams = new Set<string>();
    let endpointsMissingPathExamples = 0;
    for (const ep of endpoints) {
      let epHadMiss = false;
      for (const p of ep.parameters) {
        if (p.in !== "path" || !p.required) continue;
        const hasExample =
          p.example !== undefined ||
          (p.schema && (p.schema as any).example !== undefined) ||
          (p.schema && (p.schema as any).default !== undefined);
        const filledInEnv = (() => {
          const v = envForWarnings[p.name];
          return typeof v === "string" && v.length > 0 && !v.startsWith("{{");
        })();
        if (!hasExample && !filledInEnv) {
          missingPathParams.add(p.name);
          epHadMiss = true;
        }
      }
      if (epHadMiss) endpointsMissingPathExamples++;
    }
    if (missingPathParams.size > 0) {
      const sample = [...missingPathParams].sort().slice(0, 3).join(", ");
      const more = missingPathParams.size > 3 ? `, +${missingPathParams.size - 3} more` : "";
      warnings.push(
        `${missingPathParams.size} path param(s) have no examples (${sample}${more}) on ${endpointsMissingPathExamples} endpoint(s) — fill apis/<name>/.env.yaml to enable positive/smoke-positive suites`,
      );
    }

    if (deprecatedSkipped.length > 0) {
      const head = deprecatedSkipped.slice(0, 3).join(", ");
      const more = deprecatedSkipped.length > 3 ? `, +${deprecatedSkipped.length - 3} more` : "";
      warnings.push(
        `Skipped ${deprecatedSkipped.length} deprecated endpoint(s): ${head}${more} — pass --include-deprecated to include`,
      );
    }

    // ARV-15: warn when in-scope endpoints will create/modify real resources.
    // POST/PUT/PATCH/DELETE on a live API send real traffic — e.g. an
    // email API's `POST /emails` literally sends mail; deleting a record
    // is irreversible.
    // Generation is harmless (just YAML), but `zond run` against the suite
    // is not, so the warning fires here so the user sees it before they grep
    // the output for what to run next.
    const unsafeOps = endpoints.filter(
      ep => ep.method !== "GET" && ep.method !== "HEAD" && ep.method !== "OPTIONS",
    );
    if (unsafeOps.length > 0) {
      const byMethod = new Map<string, number>();
      for (const ep of unsafeOps) {
        byMethod.set(ep.method, (byMethod.get(ep.method) ?? 0) + 1);
      }
      const breakdown = [...byMethod.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([m, n]) => `${n} ${m}`)
        .join(", ");
      warnings.push(
        `${unsafeOps.length} write endpoint(s) in scope (${breakdown}) — \`zond run\` on the resulting *-unsafe.yaml / crud-*.yaml suites will hit the real API. Use --include 'method:GET' for read-only smoke first.`,
      );
    }

    // Ensure output directory exists
    await mkdir(options.output, { recursive: true });

    // Write suite files
    // ARV-15: tag each created file as safe/unsafe based on suite tags so the
    // stdout summary can group them and the user can tell at a glance which
    // suites send writes/deletes vs. read-only smoke.
    const UNSAFE_TAGS = new Set(["unsafe", "crud", "system", "reset", "cleanup"]);
    const isUnsafeSuite = (s: typeof suites[number]) =>
      (s.tags ?? []).some(t => UNSAFE_TAGS.has(t));
    const createdFiles: Array<{ file: string; suite: string; tests: number; safety: "safe" | "unsafe" }> = [];
    const manifestEntries: RecordInput[] = [];
    const inferredApi = inferApiName(options.output);

    for (const suite of suites) {
      const yaml = serializeSuite(suite);
      const fileName = `${suite.fileStem ?? suite.name}.yaml`;
      const filePath = join(options.output, fileName);
      const header = autoGenHeader("zond generate", `zond generate --api <name> --output ${options.output}`);
      await Bun.write(filePath, header + yaml);
      createdFiles.push({
        file: filePath,
        suite: suite.name,
        tests: suite.tests.length,
        safety: isUnsafeSuite(suite) ? "unsafe" : "safe",
      });
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
      // ARV-15: split safe vs unsafe so the user can see at a glance which
      // suites are read-only smoke and which will send writes/deletes.
      const safeFiles = createdFiles.filter(f => f.safety === "safe");
      const unsafeFiles = createdFiles.filter(f => f.safety === "unsafe");
      if (safeFiles.length > 0 && unsafeFiles.length > 0) {
        console.log(`  Safe (read-only) — ${safeFiles.length} suite(s):`);
        for (const f of safeFiles) console.log(`    ${f.file} (${f.tests} tests)`);
        console.log(`  Unsafe (writes/deletes — hit live API) — ${unsafeFiles.length} suite(s):`);
        for (const f of unsafeFiles) console.log(`    ${f.file} (${f.tests} tests)`);
      } else {
        for (const f of createdFiles) {
          console.log(`  ${f.file} (${f.tests} tests)`);
        }
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
      console.log("  2. zond run <output> --safe --report json                       # smoke (GET-only)");
      console.log(`  3. zond run <output> --tag crud,setup --validate-schema --spec ${options.specPath} --report json`);
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
import { getApi } from "../util/api-context.ts";

export function registerGenerate(program: Command): void {
  program
    .command("generate [spec]")
    .description("Generate test suites from OpenAPI spec (overwrites existing suite files unconditionally — re-run is safe; user-edited tests are not preserved). Body fields are filled with `{{$random*}}` helpers (slug/email/url/uuid/…) — see `zond reference random-helpers` or docs/random-helpers.md for the full list (TASK-267).")
    .option("--api <name>", "Use the registered API's spec (apis/<name>/spec.json)")
    .option("--db <path>", "Path to SQLite database file")
    .option("--output <dir>", "Output directory for generated test files (required unless --explain)")
    .option("--tag <tag>", "Generate only for endpoints with this tag (accepts comma-separated list, e.g. --tag Releases,Events,Alerts — TASK-239)")
    .option(
      "--include <spec...>",
      "ARV-9: keep only operations matching <selector>:<value>. Selectors: path:<regex>, method:<csv>, tag:<csv>, operation-id:<regex>. Repeat the flag for OR semantics.",
    )
    .option(
      "--exclude <spec...>",
      "ARV-9: drop operations matching <selector>:<value>. Same grammar as --include.",
    )
    .option("--uncovered-only", "Skip endpoints already covered by existing tests")
    .option("--include-deprecated", "Generate suites for deprecated endpoints too (filtered out by default)")
    .option("--explain", "Print the CRUD detection table (which resources became chain candidates and why) without writing files (TASK-139)")
    .option("--force, --overwrite", "Accepted for compatibility — generate already overwrites by default (TASK-219). No-op today; will gate user-edited file overwrites in a future release.")
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
        includeDeprecated: opts.includeDeprecated === true,
        explain: opts.explain === true,
        force: opts.force === true || opts.overwrite === true,
        json: globalJson(cmd),
        include: Array.isArray(opts.include) ? opts.include : undefined,
        exclude: Array.isArray(opts.exclude) ? opts.exclude : undefined,
        apiName: getApi(cmd, opts),
      });
    });
}
