/**
 * Build `.api-fixtures.yaml` — manifest of variables this API needs from
 * the user's `.env.yaml`.
 *
 * Purpose: when the skill (or `zond doctor`, future) needs to tell the
 * user what to fill in before scenarios will run, it reads this manifest
 * instead of inferring fixtures from generated tests. The manifest is
 * derived purely from the OpenAPI spec — auth schemes, required path
 * params, server URL — so it's stable across re-runs of `generate`.
 *
 * Manifest is read-only (regenerate via `zond refresh-api`); user edits
 * land in `.env.yaml`, not here.
 */

import type { EndpointInfo, SecuritySchemeInfo } from "./types.ts";
import { schemeVarName, resourceVar } from "./suite-generator.ts";
import type { ApiResourceMap } from "./resources-builder.ts";

export type FixtureSource = "auth" | "server" | "path" | "header" | "body-fk" | "capture-chain";

export interface FixtureRequirement {
  /** Variable name as referenced via {{var}} in tests. */
  name: string;
  /** Where this fixture comes from in the spec. */
  source: FixtureSource;
  /** Free-text description for the user (one line). */
  description: string;
  /** Endpoints affected if this fixture is missing (sample, ≤10). */
  affectedEndpoints: string[];
  /** True when at least one consumer marks this required. */
  required: boolean;
  /** Suggested placeholder value, used to seed `.env.yaml`. */
  defaultValue?: string;
}

export interface ApiFixtureManifest {
  generatedAt: string;
  specHash: string;
  fixtureCount: number;
  fixtures: FixtureRequirement[];
}

function epLabel(ep: EndpointInfo): string {
  return `${ep.method.toUpperCase()} ${ep.path}`;
}

function pushAffected(req: FixtureRequirement, ep: EndpointInfo): void {
  if (req.affectedEndpoints.length >= 10) return;
  const label = epLabel(ep);
  if (!req.affectedEndpoints.includes(label)) req.affectedEndpoints.push(label);
}

export interface BuildFixturesParams {
  endpoints: EndpointInfo[];
  securitySchemes: SecuritySchemeInfo[];
  baseUrl?: string;
  specHash: string;
  /**
   * Resource map (CRUD groups + body-FK refs) — when provided, the manifest
   * also lists body-FK and capture-chain variables that the test generator
   * will reference. Keeps `.api-fixtures.yaml` in sync with what generated
   * tests actually consume (per decision-7: manifest = source of truth for
   * the *list* of variables).
   */
  resourceMap?: ApiResourceMap;
}

export function buildApiFixtureManifest(params: BuildFixturesParams): ApiFixtureManifest {
  const fixtures = new Map<string, FixtureRequirement>();

  // 1. Server URL → base_url
  fixtures.set("base_url", {
    name: "base_url",
    source: "server",
    description: params.baseUrl
      ? `Base URL of the API (from spec: ${params.baseUrl}).`
      : `Base URL of the API. Spec did not declare a server — fill in manually.`,
    affectedEndpoints: ["*"],
    required: true,
    defaultValue: params.baseUrl ?? "",
  });

  // 2. Auth schemes → auth tokens
  // We map each scheme that endpoints actually reference into an env var.
  const usedSchemeNames = new Set<string>();
  for (const ep of params.endpoints) {
    for (const s of ep.security) usedSchemeNames.add(s);
  }
  for (const scheme of params.securitySchemes) {
    if (!usedSchemeNames.has(scheme.name)) continue;
    const varName = schemeVarName(scheme, params.securitySchemes);
    let description: string;
    if (scheme.type === "http" && scheme.scheme === "bearer") {
      description = `Bearer token for security scheme "${scheme.name}".`;
    } else if (scheme.type === "apiKey") {
      description = `API key for "${scheme.name}" (sent as ${scheme.in === "header" ? `header ${scheme.apiKeyName}` : `${scheme.in} param ${scheme.apiKeyName}`}).`;
    } else if (scheme.type === "oauth2") {
      description = `OAuth2 access token for scheme "${scheme.name}".`;
    } else {
      description = `Token for security scheme "${scheme.name}" (${scheme.type}).`;
    }
    const existing = fixtures.get(varName);
    if (existing) {
      // Multiple schemes might collapse to one var (single-bearer case).
      // Keep the most informative description.
      if (description.length > existing.description.length) existing.description = description;
    } else {
      fixtures.set(varName, {
        name: varName,
        source: "auth",
        description,
        affectedEndpoints: [],
        required: true,
        defaultValue: "",
      });
    }
    const req = fixtures.get(varName)!;
    for (const ep of params.endpoints) {
      if (ep.security.includes(scheme.name)) pushAffected(req, ep);
    }
  }

  // 3. Required path params → one var per unique name
  for (const ep of params.endpoints) {
    for (const p of ep.parameters) {
      if (p.in !== "path") continue;
      if (p.required === false) continue;
      const name = p.name;
      let req = fixtures.get(name);
      if (!req) {
        const schema = p.schema as { type?: string; format?: string; example?: unknown } | undefined;
        let defaultValue = "";
        if (schema?.example !== undefined) defaultValue = String(schema.example);
        else if (schema?.format === "uuid") defaultValue = "";
        else if (schema?.type === "integer" || schema?.type === "number") defaultValue = "";

        req = {
          name,
          source: "path",
          description: `Path parameter ${name}${schema?.format ? ` (${schema.format})` : schema?.type ? ` (${schema.type})` : ""}. Set to a real id from your account, or leave blank to skip dependent tests.`,
          affectedEndpoints: [],
          required: true,
          defaultValue,
        };
        fixtures.set(name, req);
      }
      pushAffected(req, ep);
    }
  }

  // 4. Required header params → one var per unique name (skip Authorization
  //    & Content-Type — those are handled by auth + suite headers).
  for (const ep of params.endpoints) {
    for (const p of ep.parameters) {
      if (p.in !== "header") continue;
      if (p.required === false) continue;
      const lname = p.name.toLowerCase();
      if (lname === "authorization" || lname === "content-type" || lname === "accept") continue;
      const varName = lname.replace(/-/g, "_");
      let req = fixtures.get(varName);
      if (!req) {
        req = {
          name: varName,
          source: "header",
          description: `Required header ${p.name}.`,
          affectedEndpoints: [],
          required: true,
          defaultValue: "",
        };
        fixtures.set(varName, req);
      }
      pushAffected(req, ep);
    }
  }

  // 5. Body-FK fields — required parent-id fields in request bodies that
  //    the generator copies from `.env.yaml` (e.g. `audience_id` in
  //    POST /contacts). Without these in the manifest, prepare-fixtures
  //    discovers/seeds nothing for them and `zond audit` 422s on first
  //    nested resource. Walks ALL mutating endpoints (not only full
  //    CRUD groups) so POST-only resources still surface their FK deps.
  //    Source precedence: path > body-fk (path-params more constraining).
  for (const ep of params.endpoints) {
    const method = ep.method.toUpperCase();
    if (method !== "POST" && method !== "PUT" && method !== "PATCH") continue;
    const schema = ep.requestBodySchema as
      | { properties?: Record<string, unknown>; required?: string[] }
      | undefined;
    if (!schema?.properties) continue;
    const required = new Set(schema.required ?? []);
    for (const fieldName of Object.keys(schema.properties)) {
      if (!/_id$|Id$|_uuid$/.test(fieldName)) continue;
      if (!required.has(fieldName)) continue;
      const existing = fixtures.get(fieldName);
      if (existing) {
        // Already covered (likely as path-param). Keep the existing entry
        // and just surface the additional affected endpoint.
        pushAffected(existing, ep);
        continue;
      }
      fixtures.set(fieldName, {
        name: fieldName,
        source: "body-fk",
        description: `Foreign-key id consumed by ${epLabel(ep)} request body. Set to a real id from your account, or leave blank to skip dependent tests.`,
        affectedEndpoints: [epLabel(ep)],
        required: true,
        defaultValue: "",
      });
    }
  }

  // 6. CRUD-chain capture vars — the generator emits `capture: <resource>_id`
  //    in POST steps and references {{<resource>_id}} downstream. These are
  //    auto-captured at runtime; surfacing them in the manifest keeps the
  //    "var in tests but not in manifest" contract intact (per decision-7)
  //    and lets prepare-fixtures distinguish "captured automatically" from
  //    "user must fill". required: false — env override is advanced-only.
  if (params.resourceMap) {
    for (const r of params.resourceMap.resources) {
      if (!r.endpoints.create) continue;
      const captureName = resourceVar(r.resource, "id");
      if (fixtures.has(captureName)) continue;
      const description = `Captured automatically from ${r.endpoints.create} response (field "${r.captureField}") and used in downstream CRUD steps. Set in .env.yaml only to override the captured value.`;
      const affectedFromGroup = Object.entries(r.endpoints)
        .filter(([k]) => k !== "list" && k !== "create")
        .map(([, v]) => v as string);
      const req: FixtureRequirement = {
        name: captureName,
        source: "capture-chain",
        description,
        affectedEndpoints: affectedFromGroup.slice(0, 10),
        required: false,
        defaultValue: "",
      };
      fixtures.set(captureName, req);
    }
  }

  const ordered = Array.from(fixtures.values()).sort((a, b) => {
    const sourceOrder: Record<FixtureSource, number> = {
      server: 0,
      auth: 1,
      header: 2,
      path: 3,
      "body-fk": 4,
      "capture-chain": 5,
    };
    if (sourceOrder[a.source] !== sourceOrder[b.source]) {
      return sourceOrder[a.source] - sourceOrder[b.source];
    }
    return a.name.localeCompare(b.name);
  });

  return {
    generatedAt: new Date().toISOString(),
    specHash: params.specHash,
    fixtureCount: ordered.length,
    fixtures: ordered,
  };
}

// ── YAML serialization ──

function escape(s: string): string {
  if (/[:#\[\]{}&*!|>'"@`,%]/.test(s) || s.includes("\n") || s === "") {
    return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
  }
  return s;
}

export function serializeApiFixtureManifest(m: ApiFixtureManifest): string {
  const lines: string[] = [];
  lines.push("# Auto-generated by zond. Do not edit by hand.");
  lines.push("# Read-only manifest of variables this API needs in .env.yaml.");
  lines.push("# Regenerate via: zond refresh-api <name>");
  lines.push(`generatedAt: ${escape(m.generatedAt)}`);
  lines.push(`specHash: ${escape(m.specHash)}`);
  lines.push(`fixtureCount: ${m.fixtureCount}`);
  lines.push("fixtures:");
  for (const f of m.fixtures) {
    lines.push(`  - name: ${escape(f.name)}`);
    lines.push(`    source: ${f.source}`);
    lines.push(`    required: ${f.required}`);
    lines.push(`    description: ${escape(f.description)}`);
    if (f.defaultValue !== undefined) {
      lines.push(`    defaultValue: ${escape(f.defaultValue)}`);
    }
    if (f.affectedEndpoints.length === 0) {
      lines.push(`    affectedEndpoints: []`);
    } else {
      lines.push(`    affectedEndpoints:`);
      for (const e of f.affectedEndpoints) lines.push(`      - ${escape(e)}`);
    }
  }
  return lines.join("\n") + "\n";
}
