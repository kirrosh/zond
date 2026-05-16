/**
 * ARV-116 (m-19): runner that turns an `OutputSpec` + CLI flags into
 * a `ResolvedOutput`, then renders and writes the payload.
 *
 * Resolution order:
 *   1. `--json` and `--report` are mutually exclusive — error.
 *   2. If `--report` is set, look it up in `aliases` first, then in
 *      `formats`. Unknown → error (consistent with ARV-97; never
 *      silently swallow a typo).
 *   3. If `--json` is set, pick the first envelope-wrapping format
 *      from the spec. Specs without one fall back to the
 *      `defaultFormat` (acceptable for commands like `run` whose
 *      `--json` is special-cased — see ARV-117).
 *   4. Otherwise use `defaultFormat`.
 *   5. Channel: `--output` forces file. Without it, take the format's
 *      `defaultChannel`. File channel without an explicit `--output`
 *      uses `defaultFilename` (relative paths resolved against cwd).
 */
import { resolve as resolvePath } from "path";
import {
  OutputSpecError,
  type OutputOptions,
  type OutputSpec,
  type ResolvedOutput,
} from "./types.ts";

export function resolveOutput<P>(
  spec: OutputSpec<P>,
  opts: OutputOptions,
): ResolvedOutput {
  if (opts.json && typeof opts.report === "string" && opts.report.length > 0) {
    throw new OutputSpecError(
      "--json and --report are mutually exclusive — pick one output channel",
    );
  }

  // Step 1: resolve the format.
  let format: string;
  if (typeof opts.report === "string" && opts.report.length > 0) {
    const alias = spec.aliases?.[opts.report];
    format = alias ?? opts.report;
  } else if (opts.json) {
    format = pickEnvelopeFormat(spec) ?? spec.defaultFormat;
  } else {
    format = spec.defaultFormat;
  }

  const policy = spec.formats[format];
  if (!policy) {
    const known = Object.keys(spec.formats).sort().join(", ");
    throw new OutputSpecError(
      `Unknown --report format: "${format}". Available for ${spec.command}: ${known}`,
    );
  }

  // Step 2: resolve channel + path.
  const explicitOutput = typeof opts.output === "string" && opts.output.length > 0
    ? opts.output
    : undefined;
  let channel: "stdout" | "file";
  let path: string | undefined;
  if (explicitOutput) {
    channel = "file";
    path = resolvePath(explicitOutput);
  } else if (policy.defaultChannel === "file") {
    channel = "file";
    path = policy.defaultFilename ? resolvePath(policy.defaultFilename) : undefined;
    if (!path) {
      throw new OutputSpecError(
        `Format "${format}" defaults to file but has no defaultFilename and --output was not set`,
      );
    }
  } else {
    channel = "stdout";
  }

  return {
    format,
    channel,
    path,
    envelopeWrap: policy.envelopeWrap === true,
  };
}

function pickEnvelopeFormat<P>(spec: OutputSpec<P>): string | undefined {
  for (const [name, policy] of Object.entries(spec.formats)) {
    if (policy.envelopeWrap) return name;
  }
  return undefined;
}

export interface RunOutputResult<P> {
  resolved: ResolvedOutput;
  payload: P;
  exitCode: number;
}

/** Render and write the payload according to the resolved decision.
 *  Returns the resolved decision plus the exit code from the spec's
 *  `exitCodePolicy` (0 by default). The CLI handler typically passes
 *  the exit code straight to `process.exit`. */
export async function runCommandWithOutput<P>(
  spec: OutputSpec<P>,
  opts: OutputOptions,
  produce: () => Promise<P>,
): Promise<RunOutputResult<P>> {
  const resolved = resolveOutput(spec, opts);
  const payload = await produce();

  if (!spec.render) {
    throw new OutputSpecError(
      `OutputSpec for "${spec.command}" has no render() hook — cannot serialise payload`,
    );
  }
  const body = spec.render(resolved.format, payload);

  if (resolved.channel === "file") {
    await Bun.write(resolved.path!, body);
  } else {
    process.stdout.write(body);
    if (!body.endsWith("\n")) process.stdout.write("\n");
  }

  const exitCode = spec.exitCodePolicy ? spec.exitCodePolicy(payload) : 0;
  return { resolved, payload, exitCode };
}
