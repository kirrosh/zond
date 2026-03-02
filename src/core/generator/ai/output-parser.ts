import type { RawSuite } from "../serializer.ts";
import { serializeSuite } from "../serializer.ts";
import { TestSuiteSchema } from "../../parser/schema.ts";

export interface ParseResult {
  suites: RawSuite[];
  yaml: string;
  errors: string[];
}

export function parseAIResponse(raw: string): ParseResult {
  const errors: string[] = [];

  // Sanitize first (fix template vars, NaN, etc.) so extractJson's
  // bracket-matching isn't confused by bare {{...}} tokens
  const sanitized = sanitizeJson(raw);

  // Extract JSON from response (handle fences, leading text)
  const json = extractJson(sanitized);
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
      // Try to auto-fix and re-validate
      const fixed = autoFixSuite(rawSuite);
      const retry = TestSuiteSchema.safeParse(fixed);
      if (retry.success) {
        validSuites.push(fixed as unknown as RawSuite);
        yamlParts.push(serializeSuite(fixed as unknown as RawSuite));
        continue;
      }
      const issues = result.error.issues.map((issue) =>
        `${issue.path.join(".")}: ${issue.message}`
      ).join("; ");
      errors.push(`Suite "${(rawSuite as any).name ?? i + 1}" validation: ${issues}`);
      continue;
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

/** Fix common LLM JSON mistakes before parsing */
function sanitizeJson(json: string): string {
  let s = json;

  // 1. Fix broken template vars: {{$randomString} → {{$randomString}}
  s = s.replace(/\{\{([$]?\w+)\}(?!\})/g, '{{$1}}');

  // 2. Quote bare (unquoted) {{...}} template vars outside of JSON strings.
  //    Walk character-by-character to track string context.
  s = quoteBareTemplateVars(s);

  // 3. Replace bare NaN / Infinity / undefined with null
  s = s.replace(/\bNaN\b/g, 'null');
  s = s.replace(/\bundefined\b/g, 'null');
  s = s.replace(/-?\bInfinity\b/g, 'null');

  // 4. Remove trailing commas before } or ]
  s = s.replace(/,(\s*[}\]])/g, '$1');

  // 5. Try parsing; if it fails, attempt to fix unbalanced brackets
  try { JSON.parse(s); } catch {
    s = fixUnbalancedBrackets(s);
  }

  return s;
}

/** Wrap bare {{...}} tokens (outside JSON strings) in quotes */
function quoteBareTemplateVars(json: string): string {
  const result: string[] = [];
  let inString = false;
  let escape = false;

  for (let i = 0; i < json.length; i++) {
    const ch = json[i]!;

    if (escape) { escape = false; result.push(ch); continue; }
    if (ch === '\\' && inString) { escape = true; result.push(ch); continue; }
    if (ch === '"') { inString = !inString; result.push(ch); continue; }

    // Inside a JSON string, {{ }} are fine — leave them as-is
    if (inString) { result.push(ch); continue; }

    // Outside a string: check for {{ start
    if (ch === '{' && json[i + 1] === '{') {
      // Find the closing }}
      const end = json.indexOf('}}', i + 2);
      if (end !== -1) {
        const tpl = json.slice(i, end + 2); // e.g. "{{$randomInt}}"
        result.push('"', tpl, '"');
        i = end + 1; // skip past }}
        continue;
      }
    }

    result.push(ch);
  }

  return result.join('');
}

/** Remove excess closing brackets/braces by tracking depth */
function fixUnbalancedBrackets(json: string): string {
  const result: string[] = [];
  let inString = false;
  let escape = false;
  const stack: string[] = [];

  for (let i = 0; i < json.length; i++) {
    const ch = json[i]!;
    if (escape) { escape = false; result.push(ch); continue; }
    if (ch === '\\' && inString) { escape = true; result.push(ch); continue; }
    if (ch === '"') { inString = !inString; result.push(ch); continue; }
    if (inString) { result.push(ch); continue; }

    if (ch === '{' || ch === '[') {
      stack.push(ch);
      result.push(ch);
    } else if (ch === '}' || ch === ']') {
      const expected = ch === '}' ? '{' : '[';
      if (stack.length > 0 && stack[stack.length - 1] === expected) {
        stack.pop();
        result.push(ch);
      }
      // else: skip the excess closing bracket
    } else {
      result.push(ch);
    }
  }

  return result.join('');
}

function extractJson(raw: string): string | null {
  // Try 1: Extract from ```json ... ``` fences (use last match for thinking models)
  const fenceMatches = [...raw.matchAll(/```(?:json)?\s*\n?([\s\S]*?)```/g)];
  if (fenceMatches.length > 0) {
    return fenceMatches[fenceMatches.length - 1]![1]!.trim();
  }

  // Try 2: Find all balanced JSON blocks, return the largest one
  // (thinking models put explanatory JSON snippets before the final answer)
  const candidates: string[] = [];
  for (let pos = 0; pos < raw.length; pos++) {
    const ch = raw[pos];
    if (ch !== "{" && ch !== "[") continue;

    const open = ch;
    const close = ch === "{" ? "}" : "]";
    let depth = 0;
    let inString = false;
    let escape = false;

    for (let i = pos; i < raw.length; i++) {
      const c = raw[i];
      if (escape) { escape = false; continue; }
      if (c === "\\") { escape = true; continue; }
      if (c === '"') { inString = !inString; continue; }
      if (inString) continue;

      if (c === open) depth++;
      if (c === close) {
        depth--;
        if (depth === 0) {
          candidates.push(raw.slice(pos, i + 1));
          pos = i; // skip past this block
          break;
        }
      }
    }
  }

  if (candidates.length === 0) return null;

  // Return the largest candidate (most likely the full answer, not a snippet)
  return candidates.reduce((a, b) => a.length >= b.length ? a : b);
}

function fixBodyAssertions(body: Record<string, unknown>): Record<string, unknown> {
  const fixed: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(body)) {
    if (val === null || val === undefined) {
      // null/undefined → { exists: true }
      fixed[key] = { exists: true };
    } else if (typeof val === "string") {
      // bare string → { type: string }
      fixed[key] = { type: val };
    } else if (typeof val === "object" && val !== null) {
      const rule = val as Record<string, unknown>;
      // Coerce "true"/"false" strings to boolean for `exists`
      if (typeof rule.exists === "string") {
        rule.exists = rule.exists === "true";
      }
      fixed[key] = rule;
    } else {
      fixed[key] = val;
    }
  }
  return fixed;
}

function transformSuite(obj: Record<string, unknown>): Record<string, unknown> {
  const tests = obj.tests as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(tests)) return obj;

  const transformedTests = tests.map((step) => {
    // Ensure expect exists
    if (!step.expect) {
      step.expect = {};
    }

    const expect = step.expect as Record<string, unknown>;
    if (expect.body && typeof expect.body === "object" && expect.body !== null) {
      expect.body = fixBodyAssertions(expect.body as Record<string, unknown>);
    }

    return step;
  });

  return { ...obj, tests: transformedTests };
}

/** Deep-fix a suite that failed validation — coerce types LLMs commonly get wrong */
function autoFixSuite(obj: Record<string, unknown>): Record<string, unknown> {
  const tests = obj.tests as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(tests)) return obj;

  const fixedTests = tests.map((step) => {
    const expect = step.expect as Record<string, unknown> | undefined;
    if (!expect) return step;

    // Fix status as string → number
    if (typeof expect.status === "string") {
      const n = parseInt(expect.status as string, 10);
      if (!isNaN(n)) expect.status = n;
    }

    // Fix body assertions again (in case transformSuite missed edge cases)
    if (expect.body && typeof expect.body === "object" && expect.body !== null) {
      expect.body = fixBodyAssertions(expect.body as Record<string, unknown>);
    }

    return step;
  });

  return { ...obj, tests: fixedTests };
}
