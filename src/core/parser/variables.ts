import { dirname } from "path";
import type { TestStep } from "./types.ts";

const NAMES = ["John Smith", "Jane Doe", "Alice Brown", "Bob Wilson", "Emma Davis", "James Miller"];
const CHARS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

function randomFrom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function randomChars(len: number): string {
  let result = "";
  for (let i = 0; i < len; i++) {
    result += CHARS[Math.floor(Math.random() * CHARS.length)];
  }
  return result;
}

export const GENERATORS: Record<string, () => string | number> = {
  "$uuid": () => crypto.randomUUID(),
  "$timestamp": () => Math.floor(Date.now() / 1000),
  "$randomName": () => randomFrom(NAMES),
  "$randomEmail": () => `${randomChars(8).toLowerCase()}@test.com`,
  "$randomInt": () => Math.floor(Math.random() * 10000),
  "$randomString": () => randomChars(8),
};

const VAR_PATTERN = /\{\{(.+?)\}\}/g;

export function substituteString(template: string, vars: Record<string, unknown>): unknown {
  // If entire string is a single {{var}}, return raw value (number stays number)
  const singleMatch = template.match(/^\{\{([^{}]+)\}\}$/);
  if (singleMatch) {
    const key = singleMatch[1]!;
    if (key in vars) return vars[key];
    if (key in GENERATORS) return GENERATORS[key]!();
    return template;
  }

  // Create new regex each time to avoid lastIndex issues with /g flag
  return template.replace(new RegExp(VAR_PATTERN.source, "g"), (_, key: string) => {
    if (key in vars) return String(vars[key]);
    if (key in GENERATORS) return String(GENERATORS[key]!());
    return `{{${key}}}`;
  });
}

export function substituteDeep<T>(value: T, vars: Record<string, unknown>): T {
  if (typeof value === "string") {
    return substituteString(value, vars) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => substituteDeep(item, vars)) as T;
  }
  if (typeof value === "object" && value !== null) {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      result[k] = substituteDeep(v, vars);
    }
    return result as T;
  }
  return value;
}

export function substituteStep(step: TestStep, vars: Record<string, unknown>): TestStep {
  const result: TestStep = {
    ...step,
    path: substituteString(step.path, vars) as string,
    expect: { ...step.expect },
  };

  if (step.headers) {
    result.headers = substituteDeep(step.headers, vars);
  }
  if (step.json !== undefined) {
    result.json = substituteDeep(step.json, vars);
  }
  if (step.form) {
    result.form = substituteDeep(step.form, vars);
  }
  if (step.query) {
    result.query = substituteDeep(step.query, vars);
  }
  if (step.expect.body) {
    result.expect.body = substituteDeep(step.expect.body, vars);
  }

  return result;
}

export function extractVariableReferences(step: TestStep): string[] {
  const refs = new Set<string>();
  const scan = (value: unknown): void => {
    if (typeof value === "string") {
      for (const match of value.matchAll(VAR_PATTERN)) {
        const key = match[1]!;
        if (!key.startsWith("$")) refs.add(key);
      }
    } else if (Array.isArray(value)) {
      value.forEach(scan);
    } else if (typeof value === "object" && value !== null) {
      Object.values(value).forEach(scan);
    }
  };
  scan(step);
  return [...refs];
}

async function loadEnvFile(filePath: string): Promise<Record<string, string> | null> {
  try {
    const text = await Bun.file(filePath).text();
    const parsed = Bun.YAML.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error(`Environment file ${filePath} must contain a YAML object`);
    }
    const result: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      result[k] = String(v);
    }
    return result;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    return null;
  }
}

export async function loadEnvironment(envName?: string, searchDir: string = ".", collectionId?: number): Promise<Record<string, string>> {
  const fileName = envName ? `.env.${envName}.yaml` : ".env.yaml";

  // Try both searchDir and parent dir — env file may be in collection root while tests are in tests/ subdir
  const fileVars = await loadEnvFile(`${searchDir}/${fileName}`);
  const parentFileVars = await loadEnvFile(`${dirname(searchDir)}/${fileName}`);

  // DB fallback/merge: resolve scoped + global env from DB
  let dbVars: Record<string, string> | null = null;
  if (envName) {
    try {
      const { resolveEnvironment } = await import("../../db/queries.ts");
      dbVars = resolveEnvironment(envName, collectionId);
    } catch { /* DB not initialized — OK */ }
  }

  // Merge priority: dbGlobal < dbScoped < parentFile < file (local file beats everything)
  const merged: Record<string, string> = { ...dbVars, ...parentFileVars, ...fileVars };
  return merged;
}
