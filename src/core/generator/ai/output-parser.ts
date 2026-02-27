import type { RawSuite } from "../skeleton.ts";
import { serializeSuite } from "../skeleton.ts";
import { TestSuiteSchema } from "../../parser/schema.ts";

export interface ParseResult {
  suites: RawSuite[];
  yaml: string;
  errors: string[];
}

export function parseAIResponse(raw: string): ParseResult {
  const errors: string[] = [];

  // Extract JSON from response (handle fences, leading text)
  const json = extractJson(raw);
  if (!json) {
    return { suites: [], yaml: "", errors: ["Could not find valid JSON in LLM response"] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (e) {
    return { suites: [], yaml: "", errors: [`Invalid JSON: ${(e as Error).message}`] };
  }

  // Normalize to array of suite objects
  let suiteObjects: unknown[];
  if (Array.isArray(parsed)) {
    suiteObjects = parsed;
  } else if (typeof parsed === "object" && parsed !== null) {
    const obj = parsed as Record<string, unknown>;
    if (Array.isArray(obj.suites)) {
      suiteObjects = obj.suites;
    } else if (obj.name && Array.isArray(obj.tests)) {
      // Single suite object
      suiteObjects = [obj];
    } else {
      return { suites: [], yaml: "", errors: ["JSON does not contain a valid suite structure"] };
    }
  } else {
    return { suites: [], yaml: "", errors: ["Expected JSON object or array"] };
  }

  const validSuites: RawSuite[] = [];
  const yamlParts: string[] = [];

  for (let i = 0; i < suiteObjects.length; i++) {
    const suiteObj = suiteObjects[i];
    if (typeof suiteObj !== "object" || suiteObj === null) {
      errors.push(`Suite ${i + 1}: not a valid object`);
      continue;
    }

    // Transform method keys to the format our schema expects
    const rawSuite = transformSuite(suiteObj as Record<string, unknown>);

    // Skip suites without tests — can't serialize them
    if (!Array.isArray((rawSuite as any).tests) || (rawSuite as any).tests.length === 0) {
      errors.push(`Suite "${(rawSuite as any).name ?? i + 1}": no tests defined, skipped`);
      continue;
    }

    // Validate against Zod schema
    const result = TestSuiteSchema.safeParse(rawSuite);
    if (!result.success) {
      const issues = result.error.issues.map((issue) =>
        `${issue.path.join(".")}: ${issue.message}`
      ).join("; ");
      errors.push(`Suite "${(rawSuite as any).name ?? i + 1}" validation: ${issues}`);
    }

    validSuites.push(rawSuite as unknown as RawSuite);
    yamlParts.push(serializeSuite(rawSuite as unknown as RawSuite));
  }

  if (validSuites.length === 0 && errors.length === 0) {
    errors.push("No test suites found in LLM response");
  }

  return {
    suites: validSuites,
    yaml: yamlParts.join("\n---\n"),
    errors,
  };
}

function extractJson(raw: string): string | null {
  // Try 1: Extract from ```json ... ``` fences
  const fenceMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenceMatch) {
    return fenceMatch[1]!.trim();
  }

  // Try 2: Find first { or [ and match to last } or ]
  const firstBrace = raw.indexOf("{");
  const firstBracket = raw.indexOf("[");

  let start = -1;
  let open: string;
  let close: string;

  if (firstBrace === -1 && firstBracket === -1) return null;

  if (firstBrace === -1) {
    start = firstBracket;
    open = "[";
    close = "]";
  } else if (firstBracket === -1) {
    start = firstBrace;
    open = "{";
    close = "}";
  } else {
    start = Math.min(firstBrace, firstBracket);
    open = start === firstBrace ? "{" : "[";
    close = start === firstBrace ? "}" : "]";
  }

  // Find matching closing bracket
  let depth = 0;
  let inString = false;
  let escape = false;

  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;

    if (ch === open) depth++;
    if (ch === close) {
      depth--;
      if (depth === 0) {
        return raw.slice(start, i + 1);
      }
    }
  }

  // Fallback: return from first brace to end
  return raw.slice(start);
}

function transformSuite(obj: Record<string, unknown>): Record<string, unknown> {
  const tests = obj.tests as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(tests)) return obj;

  const transformedTests = tests.map((step) => {
    // Ensure expect exists
    if (!step.expect) {
      step.expect = {};
    }

    // Transform body assertions: if assertion value is a plain string, wrap as { type: string }
    const expect = step.expect as Record<string, unknown>;
    if (expect.body && typeof expect.body === "object") {
      const body = expect.body as Record<string, unknown>;
      for (const [key, val] of Object.entries(body)) {
        if (typeof val === "string") {
          body[key] = { type: val };
        }
      }
    }

    return step;
  });

  return { ...obj, tests: transformedTests };
}
