/**
 * SARIF v2.1.0 reporter for `zond checks` (m-15 ARV-5).
 *
 * Maps `CheckFinding[]` into a SARIF log that GitHub Code Scanning can
 * ingest via `github/codeql-action/upload-sarif@v3`. Two invariants the
 * format relies on:
 *
 *   - `tool.driver.rules` — descriptors for every registered check, so
 *     even a finding-less run carries the catalog. ruleId follows the
 *     `<category>-<check_id>` form that oasdiff uses.
 *   - `partialFingerprints.primary` — sha1(ruleId + jsonPointer +
 *     spec_hash). Stable across re-runs of the same spec, so GitHub
 *     dedupes rather than re-opening alerts every push (42Crunch-style).
 *
 * The reporter is deliberately schema-only — it builds the JSON
 * document, the CLI handles writing it to disk.
 */
import { createHash } from "node:crypto";

import { listChecks } from "./registry.ts";
import { listStatefulChecks } from "./stateful.ts";
import type { CheckFinding, Severity } from "./types.ts";
import { categoryFor, type Category } from "../severity/category.ts";
import { severityToSarifLevel } from "../severity/index.ts";

export { categoryFor };

export function ruleIdFor(checkId: string): string {
  return `${categoryFor(checkId)}-${checkId}`;
}

const severityToLevel = severityToSarifLevel;

/** RFC 6901 JSON Pointer for the operation: `/paths/<escaped>/<method>`.
 *  Escapes `~` → `~0` and `/` → `~1` so paths like `/users/{id}` survive
 *  serialization. */
export function jsonPointerForOperation(path: string, method: string): string {
  const escaped = path.replace(/~/g, "~0").replace(/\//g, "~1");
  return `/paths/${escaped}/${method.toLowerCase()}`;
}

function sha1(s: string): string {
  return createHash("sha1").update(s).digest("hex");
}

export function specHashOf(specContent: string): string {
  return sha1(specContent);
}

export function partialFingerprintFor(ruleId: string, jsonPointer: string, specHash: string): string {
  return sha1(`${ruleId}\n${jsonPointer}\n${specHash}`);
}

interface SarifReportingDescriptor {
  id: string;
  name: string;
  shortDescription: { text: string };
  defaultConfiguration: { level: "error" | "warning" | "note" };
  helpUri?: string;
  properties: {
    category: Category;
    severity: Severity;
    references: string[];
    tags: string[];
  };
}

interface SarifResult {
  ruleId: string;
  ruleIndex: number;
  level: "error" | "warning" | "note";
  message: { text: string };
  locations: Array<{
    physicalLocation: {
      artifactLocation: { uri: string; uriBaseId?: string };
      // SARIF requires region to specify at least one of startLine/charOffset/
      // byteOffset. We don't parse the spec into lines — startLine: 1 keeps
      // GitHub Code Scanning happy and the JSON Pointer travels in the
      // logicalLocations + properties below.
      region: { startLine: number; snippet: { text: string } };
    };
    logicalLocations: Array<{ fullyQualifiedName: string; kind: string }>;
  }>;
  partialFingerprints: { primary: string };
  properties: Record<string, unknown>;
}

export interface SarifLog {
  $schema: string;
  version: "2.1.0";
  runs: Array<{
    tool: {
      driver: {
        name: string;
        version: string;
        informationUri: string;
        rules: SarifReportingDescriptor[];
      };
    };
    results: SarifResult[];
  }>;
}

export interface SarifReportOptions {
  findings: CheckFinding[];
  /** Raw spec text — fed into `sha1` for the partial-fingerprint salt
   *  so two runs against the same spec produce identical fingerprints. */
  specContent: string;
  /** SARIF artifactLocation.uri. Defaults to "spec.json"; CLI sets the
   *  spec's relative path so GitHub Code Scanning links findings to the
   *  spec source file. */
  specUri?: string;
  toolVersion: string;
  toolInformationUri?: string;
}

function buildRules(): SarifReportingDescriptor[] {
  const all = [
    ...listChecks().map((c) => ({
      id: c.id,
      severity: c.severity,
      defaultExpected: c.defaultExpected,
      references: c.references,
    })),
    ...listStatefulChecks().map((c) => ({
      id: c.id,
      severity: c.severity,
      defaultExpected: c.defaultExpected,
      references: c.references,
    })),
  ];
  const seen = new Set<string>();
  const rules: SarifReportingDescriptor[] = [];
  for (const c of all) {
    const ruleId = ruleIdFor(c.id);
    if (seen.has(ruleId)) continue;
    seen.add(ruleId);
    const cat = categoryFor(c.id);
    const helpUri = c.references.find((r) => r.url)?.url;
    const descriptor: SarifReportingDescriptor = {
      id: ruleId,
      name: c.id,
      shortDescription: { text: c.defaultExpected },
      defaultConfiguration: { level: severityToLevel(c.severity) },
      properties: {
        category: cat,
        severity: c.severity,
        references: c.references.map((r) => r.id),
        tags: [cat, "openapi", "zond"],
      },
    };
    if (helpUri) descriptor.helpUri = helpUri;
    rules.push(descriptor);
  }
  return rules.sort((a, b) => a.id.localeCompare(b.id));
}

export function generateSarifReport(opts: SarifReportOptions): SarifLog {
  const specHash = specHashOf(opts.specContent);
  const specUri = opts.specUri ?? "spec.json";
  const rules = buildRules();
  const ruleIndex = new Map(rules.map((r, i) => [r.id, i] as const));

  // Sort findings deterministically so two runs over the same spec emit
  // byte-identical SARIF — GitHub diffs the file across pushes and any
  // reordering churn would re-open and re-close alerts spuriously.
  const sorted = [...opts.findings].sort((a, b) => {
    const aId = ruleIdFor(a.check);
    const bId = ruleIdFor(b.check);
    if (aId !== bId) return aId.localeCompare(bId);
    if (a.operation.path !== b.operation.path) return a.operation.path.localeCompare(b.operation.path);
    if (a.operation.method !== b.operation.method) return a.operation.method.localeCompare(b.operation.method);
    return a.message.localeCompare(b.message);
  });

  const results: SarifResult[] = sorted.map((f) => {
    const ruleId = ruleIdFor(f.check);
    const ptr = jsonPointerForOperation(f.operation.path, f.operation.method);
    const idx = ruleIndex.get(ruleId);
    if (idx === undefined) {
      throw new Error(`SARIF: no rule descriptor registered for check "${f.check}" (ruleId "${ruleId}")`);
    }
    const properties: Record<string, unknown> = {
      severity: f.severity,
      method: f.operation.method,
      path: f.operation.path,
      request_signature: f.request_signature,
      response_status: f.response_summary.status,
    };
    if (f.operation.operationId) properties.operationId = f.operation.operationId;
    if (f.response_summary.content_type) properties.response_content_type = f.response_summary.content_type;
    if (f.evidence) properties.evidence = f.evidence;
    if (f.recommended_action) properties.recommendedAction = f.recommended_action;
    return {
      ruleId,
      ruleIndex: idx,
      level: severityToLevel(f.severity),
      message: { text: f.message },
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: specUri },
            region: { startLine: 1, snippet: { text: ptr } },
          },
          logicalLocations: [{ fullyQualifiedName: ptr, kind: "object" }],
        },
      ],
      partialFingerprints: { primary: partialFingerprintFor(ruleId, ptr, specHash) },
      properties,
    };
  });

  return {
    $schema: "https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json",
    version: "2.1.0",
    runs: [
      {
        tool: {
          driver: {
            name: "zond",
            version: opts.toolVersion,
            informationUri: opts.toolInformationUri ?? "https://github.com/kirrosh/zond",
            rules,
          },
        },
        results,
      },
    ],
  };
}
