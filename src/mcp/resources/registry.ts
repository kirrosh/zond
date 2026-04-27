import {
  REFERENCE_AUTH_PATTERNS,
  REFERENCE_YAML,
  RULES_NEVER,
  RULES_SAFETY,
  WORKFLOW_DIAGNOSIS,
  WORKFLOW_SCENARIOS,
  WORKFLOW_SETUP,
  WORKFLOW_TEST_API,
} from "./content.ts";
import { catalogResourceTemplate } from "./catalog-resource.ts";
import { diagnosisResourceTemplate } from "./diagnosis-resource.ts";
import type { McpResource, McpResourceTemplate } from "./types.ts";

const MD = "text/markdown";

function staticMd(uri: string, name: string, description: string, body: string): McpResource {
  return {
    uri,
    name,
    description,
    mimeType: MD,
    read() {
      return {
        contents: [{ uri, mimeType: MD, text: body }],
      };
    },
  };
}

export const STATIC_RESOURCES: ReadonlyArray<McpResource> = [
  staticMd(
    "zond://workflow/test-api",
    "Workflow: API testing",
    "End-to-end zond workflow: init → catalog → generate → sanity → coverage levels → smoke → CRUD → coverage gaps.",
    WORKFLOW_TEST_API,
  ),
  staticMd(
    "zond://workflow/scenarios",
    "Workflow: API scenarios",
    "How to author user-journey scenario tests — captures, generators, multi-step chaining.",
    WORKFLOW_SCENARIOS,
  ),
  staticMd(
    "zond://workflow/diagnosis",
    "Workflow: Diagnose failures",
    "How to read `zond db diagnose` / `zond_diagnose` output — agent_directive, recommended_action, when to stop.",
    WORKFLOW_DIAGNOSIS,
  ),
  staticMd(
    "zond://workflow/setup",
    "Workflow: Install/update zond",
    "Detect, install, and update the zond CLI binary across macOS/Linux/Windows.",
    WORKFLOW_SETUP,
  ),
  staticMd(
    "zond://rules/safety",
    "Rules: Safety",
    "`--safe`, `--dry-run`, environment gating, tag filtering, and auth-debug discipline.",
    RULES_SAFETY,
  ),
  staticMd(
    "zond://rules/never",
    "Rules: MANDATORY NEVER",
    "Hard prohibitions covering specs, HTTP traffic, generation, auth, tagging, and runs.",
    RULES_NEVER,
  ),
  staticMd(
    "zond://reference/yaml",
    "Reference: YAML format",
    "Suite/test schema, assertions, captures, generators, ETag pattern, multipart bodies, flow control.",
    REFERENCE_YAML,
  ),
  staticMd(
    "zond://reference/auth-patterns",
    "Reference: Auth patterns",
    "Setup-suite token capture, static tokens, multi-user scenarios, tag filtering with auth.",
    REFERENCE_AUTH_PATTERNS,
  ),
];

export const RESOURCE_TEMPLATES: ReadonlyArray<McpResourceTemplate> = [
  catalogResourceTemplate,
  diagnosisResourceTemplate,
];

export function findStaticResource(uri: string): McpResource | undefined {
  return STATIC_RESOURCES.find((r) => r.uri === uri);
}

export function matchTemplate(uri: string): { template: McpResourceTemplate; params: Record<string, string> } | null {
  for (const template of RESOURCE_TEMPLATES) {
    const params = template.match(uri);
    if (params) return { template, params };
  }
  return null;
}
