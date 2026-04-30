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
import { printError, printSuccess } from "../output.ts";

export interface RefreshApiOptions {
  api: string;
  /** When provided, fetch this source and replace spec.json. Otherwise
   *  re-read the existing local snapshot and just rebuild artifacts. */
  spec?: string;
  insecure?: boolean;
  json?: boolean;
  dbPath?: string;
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
  };

  if (opts.json) {
    printJson(jsonOk("refresh-api", result));
  } else {
    printSuccess(`Refreshed '${collection.name}' (${endpointCount} endpoints)${usedExternal ? ` from ${specSource}` : ""}`);
    process.stdout.write(`  spec: ${localSpec}\n`);
    process.stdout.write(`  artifacts: ${result.artifacts.join(", ")}\n`);
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
