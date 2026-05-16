/**
 * `zond probe static` — TASK-300.
 *
 * Consolidates the two static-input probe classes (`validation` and
 * `methods`) under one entry point. Both read the spec on disk and emit
 * YAML suites without making HTTP calls; their old top-level subcommands
 * are kept as deprecated aliases (one release window) that warn and
 * dispatch through this command.
 */

import { generateNegativeProbes } from "../../../core/probe/negative-probe.ts";
import { generateMethodProbes } from "../../../core/probe/method-probe.ts";
import { loadSpecForProbe, writeProbeSuites } from "../../../core/probe/runner.ts";
import { printError, printSuccess, printWarning } from "../../output.ts";
import { jsonOk, jsonError, printJson } from "../../json-envelope.ts";
import { formatEta } from "../../../core/util/format-eta.ts";

export type ProbeStaticClass = "validation" | "methods";
const ALL_CLASSES: ProbeStaticClass[] = ["validation", "methods"];

/** ARV-249: print a scale block when probe generation lands a huge suite.
 *  A 10k-probe set under `--rate-limit 30` is >6 min of silent work in
 *  `zond run` — users assume it's hung and SIGKILL. Surfacing the math
 *  here is cheaper than wiring a progress reporter (which we do anyway in
 *  slice B), and points at `--max-per-endpoint` for sampling. */
export const LARGE_PROBE_THRESHOLD = 2000;
const ETA_RATE_LIMITS = [10, 30, 60] as const;

export function buildLargeProbeNotice(
  totalProbes: number,
  probedEndpoints: number,
): string[] {
  if (totalProbes < LARGE_PROBE_THRESHOLD || probedEndpoints <= 0) return [];
  const etaLine = ETA_RATE_LIMITS
    .map((rl) => `--rate-limit ${rl} → ~${formatEta(totalProbes / rl)}`)
    .join("   ");
  const sampleK = 3;
  const sampleTotal = Math.min(totalProbes, sampleK * probedEndpoints);
  return [
    `Large probe set: ${totalProbes} probe(s) across ${probedEndpoints} endpoint(s).`,
    `   Estimated zond run time at common rate-limits:`,
    `     ${etaLine}`,
    `   To sample, re-run with --max-per-endpoint ${sampleK} (~${sampleTotal} probe(s)).`,
  ];
}

export interface ProbeStaticOptions {
  specPath: string;
  output: string;
  tag?: string;
  maxPerEndpoint?: number;
  noCleanup?: boolean;
  useRealParents?: boolean;
  json?: boolean;
  listTags?: boolean;
  /** Subset of {validation, methods}. Defaults to both. */
  include?: ProbeStaticClass[];
}

/**
 * Parse `--include`/`--exclude` CSV into a set of {validation, methods}.
 * Returns either the resolved list (preserving canonical order) or an
 * error string suitable for `printError` / `jsonError`.
 */
export function resolveStaticClasses(
  include: string | undefined,
  exclude: string | undefined,
): { classes: ProbeStaticClass[] } | { error: string } {
  if (include && exclude) {
    return { error: "--include and --exclude are mutually exclusive" };
  }
  const parse = (csv: string): { ok: ProbeStaticClass[] } | { error: string } => {
    const tokens = csv.split(",").map((s) => s.trim()).filter(Boolean);
    if (tokens.length === 0) return { error: "empty class list" };
    const out: ProbeStaticClass[] = [];
    for (const t of tokens) {
      if (t !== "validation" && t !== "methods") {
        return { error: `unknown probe class "${t}" (allowed: validation, methods)` };
      }
      if (!out.includes(t)) out.push(t);
    }
    return { ok: out };
  };

  if (include) {
    const r = parse(include);
    if ("error" in r) return r;
    return { classes: ALL_CLASSES.filter((c) => r.ok.includes(c)) };
  }
  if (exclude) {
    const r = parse(exclude);
    if ("error" in r) return r;
    return { classes: ALL_CLASSES.filter((c) => !r.ok.includes(c)) };
  }
  return { classes: [...ALL_CLASSES] };
}

export async function probeStaticCommand(
  options: ProbeStaticOptions,
): Promise<number> {
  const include: ProbeStaticClass[] = options.include ?? [...ALL_CLASSES];
  if (include.length === 0) {
    const msg = "No probe classes selected (use --include or drop --exclude).";
    if (options.json) printJson(jsonError("probe-static", [msg]));
    else printError(msg);
    return 2;
  }

  try {
    const loaded = await loadSpecForProbe({
      specPath: options.specPath,
      tag: options.tag,
      listTags: options.listTags,
    });

    if (loaded.kind === "tags") {
      if (options.json) {
        printJson(jsonOk("probe-static", { tags: loaded.tags }));
      } else if (loaded.tags.length === 0) {
        console.log("No tags found in spec.");
      } else {
        console.log("Available tags:");
        for (const t of loaded.tags) console.log(`  - ${t}`);
      }
      return 0;
    }

    if (loaded.kind === "tag-not-found") {
      const msg = `No endpoints tagged "${loaded.tag}". Available tags: ${loaded.available.length ? loaded.available.join(", ") : "(none)"}`;
      if (options.json) printJson(jsonError("probe-static", [msg]));
      else printWarning(msg);
      return 2;
    }

    const { endpoints, securitySchemes } = loaded;
    if (endpoints.length === 0) {
      const message = "No endpoints to probe.";
      if (options.json) {
        printJson(jsonOk("probe-static", { include, files: [], message }));
      } else {
        console.log(message);
      }
      return 0;
    }

    const data: {
      include: ProbeStaticClass[];
      outputDir: string;
      validation?: {
        files: Array<{ file: string; suite: string; tests: number }>;
        probedEndpoints: number;
        skippedEndpoints: number;
        totalProbes: number;
        warnings: string[];
      };
      methods?: {
        files: Array<{ file: string; suite: string; tests: number }>;
        probedPaths: number;
        skippedPaths: number;
        totalProbes: number;
        message?: string;
      };
    } = { include, outputDir: options.output };

    if (include.includes("validation")) {
      const r = generateNegativeProbes({
        endpoints,
        securitySchemes,
        maxProbesPerEndpoint: options.maxPerEndpoint,
        noCleanup: options.noCleanup,
        useRealParents: options.useRealParents,
      });
      const w = await writeProbeSuites({
        output: options.output,
        suites: r.suites,
        command: "zond probe static --emit",
        headerExample: `zond probe static --api <name> --output ${options.output}`,
      });
      data.validation = {
        files: w.files,
        probedEndpoints: r.probedEndpoints,
        skippedEndpoints: r.skippedEndpoints,
        totalProbes: r.totalProbes,
        warnings: r.warnings,
      };
    }

    if (include.includes("methods")) {
      const r = generateMethodProbes({ endpoints, securitySchemes });
      const w = await writeProbeSuites({
        output: options.output,
        suites: r.suites,
        command: "zond probe static --emit",
        headerExample: `zond probe static --api <name> --output ${options.output}`,
      });
      const methodsBlock: NonNullable<typeof data.methods> = {
        files: w.files,
        probedPaths: r.probedPaths,
        skippedPaths: r.skippedPaths,
        totalProbes: r.totalProbes,
      };
      if (r.suites.length === 0) {
        methodsBlock.message =
          "Every path declares all of GET/POST/PUT/PATCH/DELETE — nothing to probe.";
      }
      data.methods = methodsBlock;
    }

    if (options.json) {
      printJson(jsonOk("probe-static", data));
    } else {
      const totalSuites =
        (data.validation?.files.length ?? 0) + (data.methods?.files.length ?? 0);
      const totalProbes =
        (data.validation?.totalProbes ?? 0) + (data.methods?.totalProbes ?? 0);
      printSuccess(
        `Generated ${totalSuites} probe suite(s) with ${totalProbes} probe(s) in ${options.output}`,
      );
      if (data.validation) {
        console.log(
          `  validation: ${data.validation.probedEndpoints} endpoint(s) probed, ${data.validation.skippedEndpoints} skipped (no probable surface)`,
        );
        for (const w of data.validation.warnings) printWarning(w);
      }
      if (data.methods) {
        if (data.methods.message) {
          console.log(`  methods: ${data.methods.message}`);
        } else {
          console.log(
            `  methods: ${data.methods.probedPaths} path(s) probed, ${data.methods.skippedPaths} skipped (full method coverage)`,
          );
        }
      }
      const probedEndpoints =
        (data.validation?.probedEndpoints ?? 0) + (data.methods?.probedPaths ?? 0);
      const notice = buildLargeProbeNotice(totalProbes, probedEndpoints);
      if (notice.length > 0) {
        console.log("");
        printWarning(notice[0]!);
        for (const line of notice.slice(1)) console.log(line);
      }
      console.log("");
      console.log("Next steps:");
      console.log(`  zond run ${options.output} --report json   # any 5xx → bug candidate`);
      console.log(`  zond db diagnose <run-id>                  # inspect failures`);
    }

    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (options.json) printJson(jsonError("probe-static", [message]));
    else printError(message);
    return 2;
  }
}
