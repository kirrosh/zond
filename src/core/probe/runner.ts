/**
 * Shared scaffolding for the four probe commands (`probe validation`,
 * `probe methods`, `probe mass-assignment`, `probe security`).
 *
 * Each command historically duplicated the same boilerplate: read the
 * spec, optionally filter by tag, mkdir the output dir, write the
 * generated suites with an autogen header, and record them in the
 * workspace manifest. This module collapses that scaffolding into two
 * helpers (`loadSpecForProbe` / `writeProbeSuites`) so the cli layer
 * stays thin.
 *
 * Live-runner commands (`mass-assignment`, `security`) reuse the
 * write-suites half for their `--emit-tests` flag; the actual HTTP
 * orchestration lives in `mass-assignment-probe.ts` /
 * `security-probe.ts`.
 *
 * Goals are documented in TASK-185 (m-11).
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  readOpenApiSpec,
  extractEndpoints,
  extractSecuritySchemes,
  serializeSuite,
} from "../generator/index.ts";
import type { EndpointInfo, SecuritySchemeInfo, RawSuite } from "../generator/index.ts";
import { collectTags, filterByTag } from "../generator/chunker.ts";
import {
  recordGeneratedFiles,
  inferApiName,
  autoGenHeader,
  type RecordInput,
} from "../workspace/manifest.ts";
import { findWorkspaceRoot } from "../workspace/root.ts";

export interface LoadSpecForProbeOptions {
  specPath: string;
  tag?: string;
  /** When true, the caller wants the available-tags list, not endpoints. */
  listTags?: boolean;
}

export type LoadSpecResult =
  | { kind: "endpoints"; endpoints: EndpointInfo[]; securitySchemes: SecuritySchemeInfo[] }
  | { kind: "tags"; tags: string[] }
  | { kind: "tag-not-found"; tag: string; available: string[] };

/**
 * Read the spec, optionally filter by tag, and surface either the
 * filtered endpoints or the list of available tags. Centralises the
 * tag-not-found error path so probe commands all produce identical
 * messaging.
 */
export async function loadSpecForProbe(opts: LoadSpecForProbeOptions): Promise<LoadSpecResult> {
  const doc = await readOpenApiSpec(opts.specPath);
  const allEndpoints = extractEndpoints(doc);
  const securitySchemes = extractSecuritySchemes(doc);

  if (opts.listTags) {
    return { kind: "tags", tags: collectTags(allEndpoints) };
  }

  if (opts.tag) {
    const filtered = filterByTag(allEndpoints, opts.tag);
    if (filtered.length === 0) {
      return { kind: "tag-not-found", tag: opts.tag, available: collectTags(allEndpoints) };
    }
    return { kind: "endpoints", endpoints: filtered, securitySchemes };
  }

  return { kind: "endpoints", endpoints: allEndpoints, securitySchemes };
}

export interface WriteProbeSuitesOptions {
  /** Directory to write suites into. Created recursively if missing. */
  output: string;
  /** Suites produced by the underlying probe generator. */
  suites: RawSuite[];
  /** Manifest `by` field — e.g. `"zond probe-methods --emit"`. */
  command: string;
  /** First arg of `autoGenHeader` (label). Defaults to `command`. */
  headerLabel?: string;
  /** Concrete repro command shown in the autogen header. */
  headerExample?: string;
  /** Manifest category (defaults to `"probes"`). */
  category?: RecordInput["category"];
}

export interface WroteProbeSuites {
  files: Array<{ file: string; suite: string; tests: number }>;
}

/**
 * Materialise generator output to disk and register the files in the
 * workspace manifest. Safe on empty input — returns an empty result and
 * avoids creating an empty directory (m-9 P5).
 */
export async function writeProbeSuites(
  opts: WriteProbeSuitesOptions,
): Promise<WroteProbeSuites> {
  if (opts.suites.length === 0) return { files: [] };

  await mkdir(opts.output, { recursive: true });

  const files: WroteProbeSuites["files"] = [];
  const manifestEntries: RecordInput[] = [];
  const inferredApi = inferApiName(opts.output);
  const headerLabel = opts.headerLabel ?? opts.command;
  const headerExample = opts.headerExample ?? opts.command;

  for (const suite of opts.suites) {
    const fileName = `${suite.fileStem ?? suite.name}.yaml`;
    const filePath = join(opts.output, fileName);
    await Bun.write(filePath, autoGenHeader(headerLabel, headerExample) + serializeSuite(suite));
    files.push({ file: filePath, suite: suite.name, tests: suite.tests.length });
    manifestEntries.push({
      path: filePath,
      by: opts.command,
      api: inferredApi,
      category: opts.category ?? "probes",
    });
  }

  try {
    const ws = findWorkspaceRoot();
    if (!ws.fromFallback && manifestEntries.length > 0) {
      recordGeneratedFiles(ws.root, manifestEntries);
    }
  } catch {
    /* best-effort: manifest is observability, never fail probe emit on it */
  }

  return { files };
}
