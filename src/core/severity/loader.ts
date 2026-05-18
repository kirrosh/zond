/**
 * ARV-283 Phase A: severity config loader.
 *
 * Locates and reads `.zond/severity.yaml` (workspace) and
 * `apis/<name>/.zond-severity.yaml` (per-API) for a given API name +
 * workspace root, parses them, validates each, and returns the merged
 * resolved view ready for the calibrator.
 *
 * Disk I/O lives only here — config.ts and matcher.ts stay pure so
 * they're trivially testable without filesystem fixtures.
 *
 * Lookup order (later wins on per-key conflicts; suppressions union):
 *   1. `<workspaceRoot>/.zond/severity.yaml`
 *   2. `<workspaceRoot>/apis/<api>/.zond-severity.yaml`
 *
 * Missing files are silent (config is opt-in per AC#9). Invalid YAML
 * or schema failures throw `SeverityConfigError` with file:keypath:msg
 * suitable for CLI surfacing.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as YAML from "yaml";

import type { ConfigStack, MergedConfig, SeverityConfig, ValidationError } from "./config.ts";
import { mergeConfigs, validateConfig } from "./config.ts";

export interface LoadOptions {
  /** Workspace root (where `.zond/` lives). */
  workspaceRoot: string;
  /** API name — drives the per-API config path. Pass undefined to skip
   *  per-API lookup (e.g. for workspace-level operations). */
  api?: string;
}

export class SeverityConfigError extends Error {
  constructor(public errors: ValidationError[]) {
    const msg = errors.map((e) => `${e.source}: ${e.keyPath}: ${e.message}`).join("\n");
    super(`severity config invalid:\n${msg}`);
    this.name = "SeverityConfigError";
  }
}

const EMPTY: MergedConfig = { checks: {}, suppressions: [] };

/**
 * Load + validate + merge. Returns an empty merged config when neither
 * file exists — callers should still call calibrate() (calibrator
 * passes findings through unchanged when config is empty, so the
 * downstream code path stays single).
 */
export function loadSeverityConfig(opts: LoadOptions): MergedConfig {
  const stack: ConfigStack = [];
  const errors: ValidationError[] = [];

  const wsPath = resolve(opts.workspaceRoot, ".zond", "severity.yaml");
  if (existsSync(wsPath)) {
    const result = readAndValidate(wsPath);
    if (result.errors.length > 0) errors.push(...result.errors);
    else if (result.config) stack.push({ config: result.config, source: wsPath });
  }

  if (opts.api) {
    const apiPath = resolve(opts.workspaceRoot, "apis", opts.api, ".zond-severity.yaml");
    if (existsSync(apiPath)) {
      const result = readAndValidate(apiPath);
      if (result.errors.length > 0) errors.push(...result.errors);
      else if (result.config) stack.push({ config: result.config, source: apiPath });
    }
  }

  if (errors.length > 0) throw new SeverityConfigError(errors);
  if (stack.length === 0) return EMPTY;
  return mergeConfigs(stack);
}

function readAndValidate(path: string): { config: SeverityConfig | null; errors: ValidationError[] } {
  let raw: unknown;
  try {
    raw = YAML.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    return {
      config: null,
      errors: [{ source: path, keyPath: "$", message: `YAML parse error: ${(err as Error).message}` }],
    };
  }
  const errors = validateConfig(raw, path);
  if (errors.length > 0) return { config: null, errors };
  // validateConfig guarantees shape — cast is safe
  return { config: (raw ?? { version: 1 }) as SeverityConfig, errors: [] };
}
