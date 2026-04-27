import workflowTestApi from "./content/workflow-test-api.md" with { type: "text" };
import workflowScenarios from "./content/workflow-scenarios.md" with { type: "text" };
import workflowDiagnosis from "./content/workflow-diagnosis.md" with { type: "text" };
import workflowSetup from "./content/workflow-setup.md" with { type: "text" };
import rulesSafety from "./content/rules-safety.md" with { type: "text" };
import rulesNever from "./content/rules-never.md" with { type: "text" };
import referenceYaml from "./content/reference-yaml.md" with { type: "text" };
import referenceAuthPatterns from "./content/reference-auth-patterns.md" with { type: "text" };

export const WORKFLOW_TEST_API = workflowTestApi.trim();
export const WORKFLOW_SCENARIOS = workflowScenarios.trim();
export const WORKFLOW_DIAGNOSIS = workflowDiagnosis.trim();
export const WORKFLOW_SETUP = workflowSetup.trim();
export const RULES_SAFETY = rulesSafety.trim();
export const RULES_NEVER = rulesNever.trim();
export const REFERENCE_YAML = referenceYaml.trim();
export const REFERENCE_AUTH_PATTERNS = referenceAuthPatterns.trim();
