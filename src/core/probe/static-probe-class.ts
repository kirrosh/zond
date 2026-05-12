/**
 * `StaticProbe` — Probe-contract wrapper around the static-input probe
 * generators (validation + methods) (m-17 / ARV-49).
 *
 * Static probes don't make HTTP calls — they emit YAML suites the user
 * later runs through `zond run`. dryRun lists the endpoints + classes
 * that would have suites generated; run() invokes the generators and
 * returns the produced files via `extras` (the CLI handler is
 * responsible for writing them — see `probe-static.ts`). This keeps
 * static under the same Probe contract as live probes (ARV-49 #3)
 * without forcing an artificial dry-run / run distinction the
 * generator never had.
 */
import type { Probe, ProbeContext, ProbeFlags, EndpointPlan, ProbeResult, ProbeReportFormat, ProbeEndpointResult } from "./types.ts";
import { generateNegativeProbes } from "./negative-probe.ts";
import { generateMethodProbes } from "./method-probe.ts";

const ALL_CLASSES = ["validation", "methods"] as const;
type StaticClass = typeof ALL_CLASSES[number];

const FLAGS: ProbeFlags = {
  api: true,
  tag: true,
  include: true,
  exclude: true,
  // Static probes have no live mode — dry-run vs run is not meaningful.
  // The interface still requires the slot; we expose it as a no-op
  // (`dryRun` returns the same list `run` would produce, just without
  // writing files).
  dryRun: false,
  listTags: true,
  json: true,
  output: true,
  report: true,
};

function classesFromCtx(ctx: ProbeContext): StaticClass[] {
  const raw = ctx.classes ?? [...ALL_CLASSES];
  return raw.filter((c): c is StaticClass => c === "validation" || c === "methods");
}

export class StaticProbe implements Probe {
  readonly name = "static";
  readonly description =
    "Generate static-input probe suites: validation (bogus types/values) + methods (undeclared HTTP methods). Spec-only; no live traffic.";
  readonly commonFlags = FLAGS;

  async dryRun(ctx: ProbeContext): Promise<EndpointPlan[]> {
    const classes = classesFromCtx(ctx);
    return ctx.endpoints.map((ep) => ({
      path: ep.path,
      method: ep.method.toUpperCase(),
      planned: true,
      classes_planned: [...classes],
      fields_planned: [],
      skip_reason: null,
    }));
  }

  async run(ctx: ProbeContext): Promise<ProbeResult> {
    const classes = classesFromCtx(ctx);
    const include: StaticClass[] = classes;

    const endpoints: ProbeEndpointResult[] = [];
    let totalProbes = 0;
    const warnings: string[] = [];
    const suitesPerClass: Record<string, unknown> = {};

    if (include.includes("validation")) {
      const r = generateNegativeProbes({
        endpoints: ctx.endpoints,
        securitySchemes: ctx.securitySchemes,
        maxProbesPerEndpoint: ctx.options["maxPerEndpoint"] as number | undefined,
        noCleanup: ctx.options["noCleanup"] === true,
        useRealParents: ctx.options["useRealParents"] !== false,
      });
      suitesPerClass["validation"] = {
        suites: r.suites,
        probedEndpoints: r.probedEndpoints,
        skippedEndpoints: r.skippedEndpoints,
        totalProbes: r.totalProbes,
        warnings: r.warnings,
      };
      totalProbes += r.totalProbes;
      for (const w of r.warnings) warnings.push(w);
    }

    if (include.includes("methods")) {
      const r = generateMethodProbes({
        endpoints: ctx.endpoints,
        securitySchemes: ctx.securitySchemes,
      });
      suitesPerClass["methods"] = {
        suites: r.suites,
        probedPaths: r.probedPaths,
        skippedPaths: r.skippedPaths,
        totalProbes: r.totalProbes,
      };
      totalProbes += r.totalProbes;
    }

    return {
      endpoints,
      summary: {
        totalEndpoints: ctx.endpoints.length,
        probed: ctx.endpoints.length,
        by_status: { ok: ctx.endpoints.length, high: 0, low: 0, inconclusive: 0, skipped: 0 },
      },
      warnings,
      extras: { classes: include, suites: suitesPerClass, totalProbes },
    };
  }

  report(format: ProbeReportFormat, result: ProbeResult): string | object {
    if (format === "markdown") {
      const totalProbes = (result.extras?.["totalProbes"] as number) ?? 0;
      const classes = (result.extras?.["classes"] as string[]) ?? [];
      return `Generated ${totalProbes} static-input probe(s) for class(es): ${classes.join(", ")}`;
    }
    return {
      summary: result.summary,
      ...(result.extras ?? {}),
    };
  }
}
