/**
 * Build `.api-resources.yaml` — the CRUD-chain map of an API.
 *
 * Purpose: skill code (scenario authoring, audit setup) reads this instead
 * of grep'ing the OpenAPI spec to answer "what resources can I CRUD, what
 * field captures the id, are there ETag / soft-delete pitfalls". The
 * extended form also lists FK dependencies so a scenario can plan a
 * setup chain (audience → contact requires audience_id, etc.).
 *
 * The file is git-trackable evidence of the API's surface; regenerated
 * by `zond add api` and (later) `zond refresh-api`.
 */

import type { EndpointInfo, CrudGroup } from "./types.ts";
import type { OpenAPIV3 } from "openapi-types";
import { detectCrudGroups } from "./suite-generator.ts";

export interface ResourceFkRef {
  /** Variable name expected in `.env.yaml` to satisfy the FK (e.g. `audience_id`). */
  var: string;
  /** Path-parameter or body-field name that consumes the FK in the API. */
  param: string;
  /** Where the value gets injected: path | body. */
  in: "path" | "body";
  /** Resource name we believe owns this id (best-effort, may be null). */
  ownerResource: string | null;
}

export interface ApiResourceEntry {
  resource: string;
  basePath: string;
  itemPath: string;
  idParam: string;
  /** What field on the create response carries the new id (typically `id`). */
  captureField: string;
  /** True when the resource exposes List + Create + Read at minimum. */
  hasFullCrud: boolean;
  endpoints: {
    list?: string;     // "GET /audiences"
    create?: string;
    read?: string;
    update?: string;
    delete?: string;
  };
  /** Update/Delete demand If-Match? (heuristic: 412 in spec or ETag in headers). */
  requiresEtag?: boolean;
  /** Heuristic: read-after-delete returns 200 instead of 404 (filled at runtime, default false). */
  softDelete?: boolean;
  /** Other resources whose ids this resource consumes (FK chain). */
  fkDependencies: ResourceFkRef[];
}

export interface ApiResourceMap {
  generatedAt: string;
  specHash: string;
  resourceCount: number;
  resources: ApiResourceEntry[];
  /** Endpoints that didn't fit any CRUD group (action endpoints, RPC-style). */
  orphanEndpoints: string[];
}

function epLabel(ep: EndpointInfo): string {
  return `${ep.method.toUpperCase()} ${ep.path}`;
}

function getCaptureField(create: EndpointInfo): string {
  // Look at the create endpoint's success response schema for an `id`-ish
  // field. Falls back to "id" — the universal default.
  const success = create.responses.find(r => r.statusCode >= 200 && r.statusCode < 300);
  const schema = success?.schema as OpenAPIV3.SchemaObject | undefined;
  if (schema?.properties) {
    const props = schema.properties as Record<string, OpenAPIV3.SchemaObject>;
    for (const candidate of ["id", "uuid", "key", "code"]) {
      if (props[candidate]) return candidate;
    }
  }
  return "id";
}

function inferFkOwner(paramName: string, allResources: string[]): string | null {
  // `audience_id` → match `audiences`; `contact_id` → `contacts`. Strips
  // common id-suffixes (_id, Id) and looks for plural/singular matches.
  const stem = paramName.replace(/_id$|Id$|_uuid$/, "").toLowerCase();
  if (!stem) return null;
  for (const res of allResources) {
    const r = res.toLowerCase();
    if (r === stem || r === `${stem}s` || `${r}s` === stem || r.replace(/s$/, "") === stem) {
      return res;
    }
  }
  return null;
}

function collectFkDependencies(
  group: CrudGroup,
  allResources: string[],
): ResourceFkRef[] {
  const deps: ResourceFkRef[] = [];
  const seen = new Set<string>();

  // Path-param dependencies on basePath (e.g. /audiences/{audience_id}/contacts).
  // Skip the resource's own idParam — that's the resource itself, not a dep.
  const pathParamRe = /\{([^}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = pathParamRe.exec(group.basePath)) !== null) {
    const param = match[1]!;
    if (param === group.idParam) continue;
    if (seen.has(`path:${param}`)) continue;
    seen.add(`path:${param}`);
    deps.push({
      var: param,
      param,
      in: "path",
      ownerResource: inferFkOwner(param, allResources),
    });
  }

  // Body-level FKs on create payload — fields named *_id / *_uuid that
  // aren't generated server-side. Heuristic, not exhaustive.
  if (group.create?.requestBodySchema) {
    const schema = group.create.requestBodySchema as OpenAPIV3.SchemaObject;
    const props = (schema.properties ?? {}) as Record<string, OpenAPIV3.SchemaObject>;
    const required = new Set(schema.required ?? []);
    for (const [name] of Object.entries(props)) {
      if (!/_id$|Id$|_uuid$/.test(name)) continue;
      if (!required.has(name)) continue;
      const key = `body:${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deps.push({
        var: name,
        param: name,
        in: "body",
        ownerResource: inferFkOwner(name, allResources),
      });
    }
  }

  return deps;
}

export interface BuildResourcesParams {
  endpoints: EndpointInfo[];
  specHash: string;
}

export function buildApiResourceMap(params: BuildResourcesParams): ApiResourceMap {
  const groups = detectCrudGroups(params.endpoints);
  const resourceNames = groups.map(g => g.resource);

  const resources: ApiResourceEntry[] = groups.map(g => {
    const captureField = g.create ? getCaptureField(g.create) : "id";
    const requiresEtag = !!(g.update?.requiresEtag || g.delete?.requiresEtag);
    return {
      resource: g.resource,
      basePath: g.basePath,
      itemPath: g.itemPath,
      idParam: g.idParam,
      captureField,
      hasFullCrud: !!(g.list && g.create && g.read),
      endpoints: {
        ...(g.list ? { list: epLabel(g.list) } : {}),
        ...(g.create ? { create: epLabel(g.create) } : {}),
        ...(g.read ? { read: epLabel(g.read) } : {}),
        ...(g.update ? { update: epLabel(g.update) } : {}),
        ...(g.delete ? { delete: epLabel(g.delete) } : {}),
      },
      ...(requiresEtag ? { requiresEtag: true } : {}),
      fkDependencies: collectFkDependencies(g, resourceNames),
    };
  });

  // Endpoints that aren't in any CRUD group — RPC-style actions, webhook
  // accept-only routes, etc. The skill should know these exist so it
  // doesn't think the API is fully covered by the CRUD map.
  const claimedEps = new Set<string>();
  for (const g of groups) {
    if (g.list) claimedEps.add(epLabel(g.list));
    if (g.create) claimedEps.add(epLabel(g.create));
    if (g.read) claimedEps.add(epLabel(g.read));
    if (g.update) claimedEps.add(epLabel(g.update));
    if (g.delete) claimedEps.add(epLabel(g.delete));
  }
  const orphanEndpoints = params.endpoints
    .filter(ep => !claimedEps.has(epLabel(ep)))
    .map(epLabel);

  return {
    generatedAt: new Date().toISOString(),
    specHash: params.specHash,
    resourceCount: resources.length,
    resources,
    orphanEndpoints,
  };
}

// ── YAML serialization (minimal, no dep on yaml lib for the workspace) ──

function escape(s: string): string {
  if (/[:#\[\]{}&*!|>'"@`,%]/.test(s) || s.includes("\n") || s === "") {
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return s;
}

export function serializeApiResourceMap(m: ApiResourceMap): string {
  const lines: string[] = [];
  lines.push("# Auto-generated by zond. Do not edit by hand.");
  lines.push("# Regenerate via: zond refresh-api <name>");
  lines.push(`generatedAt: ${escape(m.generatedAt)}`);
  lines.push(`specHash: ${escape(m.specHash)}`);
  lines.push(`resourceCount: ${m.resourceCount}`);
  if (m.resources.length === 0) {
    lines.push("resources: []");
  } else {
    lines.push("resources:");
  }
  for (const r of m.resources) {
    lines.push(`  - resource: ${escape(r.resource)}`);
    lines.push(`    basePath: ${escape(r.basePath)}`);
    lines.push(`    itemPath: ${escape(r.itemPath)}`);
    lines.push(`    idParam: ${escape(r.idParam)}`);
    lines.push(`    captureField: ${escape(r.captureField)}`);
    lines.push(`    hasFullCrud: ${r.hasFullCrud}`);
    if (r.requiresEtag) lines.push(`    requiresEtag: true`);
    lines.push(`    endpoints:`);
    for (const [k, v] of Object.entries(r.endpoints)) {
      lines.push(`      ${k}: ${escape(v as string)}`);
    }
    if (r.fkDependencies.length === 0) {
      lines.push(`    fkDependencies: []`);
    } else {
      lines.push(`    fkDependencies:`);
      for (const d of r.fkDependencies) {
        lines.push(`      - var: ${escape(d.var)}`);
        lines.push(`        param: ${escape(d.param)}`);
        lines.push(`        in: ${d.in}`);
        lines.push(`        ownerResource: ${d.ownerResource ? escape(d.ownerResource) : "null"}`);
      }
    }
  }
  if (m.orphanEndpoints.length === 0) {
    lines.push("orphanEndpoints: []");
  } else {
    lines.push("orphanEndpoints:");
    for (const e of m.orphanEndpoints) lines.push(`  - ${escape(e)}`);
  }
  return lines.join("\n") + "\n";
}
