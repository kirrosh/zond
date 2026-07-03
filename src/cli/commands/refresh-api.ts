/**
 * `zond refresh-api <name>` — re-fetch the OpenAPI spec and regenerate
 * the four artifacts (spec.json, .api-catalog.yaml, .api-resources.yaml,
 * .api-fixtures.yaml).
 *
 * Without --spec, refresh re-reads from the source recorded at register
 * time (treating workspace-relative paths as the local snapshot — which
 * is a no-op refresh useful only for re-emitting derived artifacts after
 * a builder change). With --spec, the new source is fetched, dereferenced,
 * and replaces the local snapshot.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getDb } from "../../db/schema.ts";
import { findCollectionByNameOrId, updateCollection } from "../../db/queries.ts";
import { findWorkspaceRoot } from "../../core/workspace/root.ts";
import { readOpenApiSpec } from "../../core/generator/openapi-reader.ts";
import {
  resolveCollectionSpec,
  writeArtifactsFromDoc,
  SPEC_SNAPSHOT_FILENAME,
} from "../../core/setup-api.ts";
import { jsonOk, jsonError, printJson } from "../json-envelope.ts";
import { printError, printSuccess, printWarning } from "../output.ts";
import { readFileSync as readFileSyncNode } from "node:fs";
import {
  loadSchemaOverlay,
  mergePatch,
  saveSchemaOverlay,
  applySchemaOverlay,
  type ResponseSchemaPatch,
} from "../../core/spec/schema-overlay.ts";

export interface RefreshApiOptions {
  api: string;
  /** When provided, fetch this source and replace spec.json. Otherwise
   *  re-read the existing local snapshot and just rebuild artifacts. */
  spec?: string;
  insecure?: boolean;
  json?: boolean;
  dbPath?: string;
  /** ARV-176: path to a patch.schema.json (from `schema-from-runs`) to fold
   *  into the response-schema overlay before rebuilding spec.json. */
  mergeSchema?: string;
  /** ARV-176: overwrite response schemas already declared upstream. */
  force?: boolean;
}

export async function refreshApiCommand(opts: RefreshApiOptions): Promise<number> {
  try {
    getDb(opts.dbPath);
  } catch (err) {
    const m = `DB unavailable: ${(err as Error).message}`;
    if (opts.json) printJson(jsonError("refresh-api", [m])); else printError(m);
    return 2;
  }

  const collection = findCollectionByNameOrId(opts.api);
  if (!collection) {
    const m = `API '${opts.api}' not found.`;
    if (opts.json) printJson(jsonError("refresh-api", [m])); else printError(m);
    return 2;
  }

  if (!collection.base_dir) {
    const m = `API '${opts.api}' has no base_dir recorded — cannot refresh artifacts.`;
    if (opts.json) printJson(jsonError("refresh-api", [m])); else printError(m);
    return 2;
  }

  const workspaceRoot = findWorkspaceRoot().root;
  const baseDir = collection.base_dir;

  // 1. Pick spec source
  let specSource: string;
  let usedExternal: boolean;
  if (opts.spec) {
    specSource = opts.spec;
    usedExternal = true;
  } else if (collection.openapi_spec) {
    specSource = resolveCollectionSpec(collection.openapi_spec);
    usedExternal = false;
    if (!existsSync(specSource) && !/^https?:\/\//i.test(specSource)) {
      const m = `Local spec snapshot missing at ${specSource}. Pass --spec <path|url> to re-pull from upstream.`;
      if (opts.json) printJson(jsonError("refresh-api", [m])); else printError(m);
      return 2;
    }
  } else {
    const m = `API '${opts.api}' has no spec recorded. Pass --spec <path|url>.`;
    if (opts.json) printJson(jsonError("refresh-api", [m])); else printError(m);
    return 2;
  }

  // 2. Dereference (fetch if URL)
  let doc: unknown;
  try {
    doc = await readOpenApiSpec(specSource, { insecure: opts.insecure });
  } catch (err) {
    const m = `Failed to read spec ${specSource}: ${(err as Error).message}`;
    if (opts.json) printJson(jsonError("refresh-api", [m])); else printError(m);
    return 2;
  }

  // 3. Determine baseUrl from the doc
  const baseUrl = ((doc as any).servers?.[0]?.url as string | undefined) ?? "";

  // ARV-176: response-schema overlay. Fold a --merge-schema patch into the
  // persistent overlay first, then apply the (possibly-updated) overlay onto
  // the freshly-pulled doc *before* it's serialised to spec.json. Applying on
  // every refresh (not only when --merge-schema is passed) is what makes the
  // overlay survive an upstream re-pull (AC#2).
  let schemaReport: {
    merged_from?: string;
    applied: string[];
    preserved: string[];
    conflicts: string[];
  } | undefined;
  if (opts.mergeSchema) {
    let incoming: ResponseSchemaPatch;
    try {
      incoming = JSON.parse(readFileSyncNode(opts.mergeSchema, "utf-8")) as ResponseSchemaPatch;
    } catch (err) {
      const m = `Failed to read --merge-schema "${opts.mergeSchema}": ${(err as Error).message}`;
      if (opts.json) printJson(jsonError("refresh-api", [m])); else printError(m);
      return 2;
    }
    const merged = mergePatch(loadSchemaOverlay(baseDir), incoming);
    saveSchemaOverlay(baseDir, merged);
  }
  const overlay = loadSchemaOverlay(baseDir);
  if (overlay) {
    const r = applySchemaOverlay(doc, overlay, { force: opts.force === true });
    schemaReport = {
      ...(opts.mergeSchema ? { merged_from: opts.mergeSchema } : {}),
      applied: r.applied,
      preserved: r.preserved,
      conflicts: r.conflicts,
    };
  }

  // 4. Write spec.json + 3 artifacts
  writeArtifactsFromDoc({
    doc,
    baseDir,
    apiName: collection.name,
    baseUrl,
    workspaceRoot,
  });

  // 5. If we pulled fresh from external, ensure the DB points to the local snapshot
  const expectedDbSpec = `apis/${collection.name}/${SPEC_SNAPSHOT_FILENAME}`;
  if (collection.openapi_spec !== expectedDbSpec) {
    updateCollection(collection.id, { openapi_spec: expectedDbSpec });
  }

  // 6. Surface result
  const localSpec = join(baseDir, SPEC_SNAPSHOT_FILENAME);
  const endpointCount = readEndpointCount(localSpec);
  const result = {
    api: collection.name,
    baseDir,
    spec: localSpec,
    pulledFrom: usedExternal ? specSource : null,
    endpointCount,
    artifacts: [".api-catalog.yaml", ".api-resources.yaml", ".api-fixtures.yaml"],
    ...(schemaReport ? { schema_overlay: schemaReport } : {}),
  };

  if (opts.json) {
    printJson(jsonOk("refresh-api", result));
  } else {
    printSuccess(`Refreshed '${collection.name}' (${endpointCount} endpoints)${usedExternal ? ` from ${specSource}` : ""}`);
    process.stdout.write(`  spec: ${localSpec}\n`);
    process.stdout.write(`  artifacts: ${result.artifacts.join(", ")}\n`);
    if (schemaReport) {
      process.stdout.write(`  schema overlay: ${schemaReport.applied.length} applied, ${schemaReport.preserved.length} preserved, ${schemaReport.conflicts.length} conflict(s)\n`);
      for (const c of schemaReport.conflicts) {
        printWarning(`schema overlay conflict (endpoint not in upstream, skipped): ${c}`);
      }
    }
    process.stdout.write(`  Run \`zond doctor --api ${collection.name}\` to verify fixtures.\n`);
  }
  return 0;
}

function readEndpointCount(specPath: string): number {
  try {
    const doc = JSON.parse(readFileSync(specPath, "utf-8")) as any;
    let count = 0;
    for (const item of Object.values(doc.paths ?? {})) {
      if (item && typeof item === "object") {
        for (const k of Object.keys(item as object)) {
          if (["get", "post", "put", "patch", "delete", "head", "options"].includes(k.toLowerCase())) count++;
        }
      }
    }
    return count;
  } catch {
    return 0;
  }
}

import type { Command } from "commander";
import { globalJson } from "../resolve.ts";

export function registerRefreshApi(program: Command): void {
  program
    .command("refresh-api <name>")
    .description("Re-snapshot the OpenAPI spec into apis/<name>/spec.json and regenerate the 3 artifacts (catalog/resources/fixtures)")
    .option("--spec <path>", "Pull fresh from this path or URL (overrides registered source)")
    .option("--insecure", "Allow self-signed TLS when --spec is an https URL")
    .option("--merge-schema <path>", "ARV-176: fold a patch.schema.json (from `zond schema-from-runs`) into the persistent response-schema overlay (.api-schema.local.yaml) and apply it to spec.json. The overlay survives future refreshes.")
    .option("--force", "ARV-176: overwrite response schemas already declared upstream (default: only fill gaps).")
    .option("--db <path>", "Path to SQLite database file")
    .action(async (name: string, opts, cmd: Command) => {
      process.exitCode = await refreshApiCommand({
        api: name,
        spec: opts.spec,
        insecure: opts.insecure === true,
        mergeSchema: typeof opts.mergeSchema === "string" ? opts.mergeSchema : undefined,
        force: opts.force === true,
        dbPath: typeof opts.db === "string" ? opts.db : undefined,
        json: globalJson(cmd),
      });
    });
}
