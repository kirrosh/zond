import type { EndpointInfo } from "./types.ts";

export type WarningCode = "deprecated" | "no_response_schema" | "no_responses_defined" | "required_params_no_examples";

export interface EndpointWarning {
  method: string;
  path: string;
  warnings: string[];
}

export function analyzeEndpoints(endpoints: EndpointInfo[]): EndpointWarning[] {
  const result: EndpointWarning[] = [];

  for (const ep of endpoints) {
    const warnings: string[] = [];

    if (ep.deprecated) {
      warnings.push("deprecated");
    }

    if (ep.responses.length === 0) {
      warnings.push("no_responses_defined");
    } else {
      const has2xx = ep.responses.filter(r => r.statusCode >= 200 && r.statusCode < 300);
      if (has2xx.length > 0 && has2xx.every(r => !r.schema)) {
        warnings.push("no_response_schema");
      }
    }

    const missingExamples = ep.parameters
      .filter(p => p.required && !p.example && !(p.schema && (p.schema as any).example) && !(p.schema && (p.schema as any).default))
      .map(p => p.name);
    if (missingExamples.length > 0) {
      warnings.push(`required_params_no_examples: ${missingExamples.join(", ")}`);
    }

    if (warnings.length > 0) {
      result.push({ method: ep.method, path: ep.path, warnings });
    }
  }

  return result;
}
