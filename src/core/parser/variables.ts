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

function lowerChars(len: number): string {
  let result = "";
  for (let i = 0; i < len; i++) {
    const idx = Math.floor(Math.random() * 36);
    result += CHARS[idx]!.toLowerCase();
  }
  return result;
}

function randomOctet(): number {
  return Math.floor(Math.random() * 254) + 1;
}

function randomDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export const GENERATORS: Record<string, () => string | number> = {
  "$uuid": () => crypto.randomUUID(),
  "$timestamp": () => Math.floor(Date.now() / 1000),
  "$isoTimestamp": () => new Date().toISOString(),
  "$randomName": () => randomFrom(NAMES),
  "$randomEmail": () => `${randomChars(8).toLowerCase()}@test.com`,
  "$randomInt": () => Math.floor(Math.random() * 10000),
  "$randomString": () => randomChars(8),
  "$randomUrl": () => `https://example-${lowerChars(8)}.com/path`,
  "$randomFqdn": () => `test-${lowerChars(8)}.example.com`,
  "$randomIpv4": () => `10.${randomOctet()}.${randomOctet()}.${randomOctet()}`,
  "$randomDate": randomDate,
  "$randomIsoDate": () => new Date().toISOString(),
};

const VAR_PATTERN = /\{\{(.+?)\}\}/g;

/**
 * Suggest a known generator close to the misspelled name.
 * Case-insensitive prefix match first, then case-insensitive exact match.
 */
function suggestGenerator(name: string): string | undefined {
  const lower = name.toLowerCase();
  const known = Object.keys(GENERATORS);
  // Case-insensitive exact (catches case-only typos like $randomfqdn → $randomFqdn)
  const ciExact = known.find((k) => k.toLowerCase() === lower);
  if (ciExact) return ciExact;
  // Prefix match
  return known.find((k) => k.toLowerCase().startsWith(lower.slice(0, 6)));
}

function unknownGeneratorError(key: string): Error {
  const suggestion = suggestGenerator(key);
  const hint = suggestion ? ` (did you mean ${suggestion}?)` : "";
  const available = Object.keys(GENERATORS).join(", ");
  return new Error(
    `Unknown generator: {{${key}}}${hint}. Available: ${available}`,
  );
}

export function substituteString(template: string, vars: Record<string, unknown>): unknown {
  // If entire string is a single {{var}}, return raw value (number stays number)
  const singleMatch = template.match(/^\{\{([^{}]+)\}\}$/);
  if (singleMatch) {
    const key = singleMatch[1]!;
    if (key in vars) return vars[key];
    if (key in GENERATORS) return GENERATORS[key]!();
    if (key.startsWith("$")) throw unknownGeneratorError(key);
    return template;
  }

  // Create new regex each time to avoid lastIndex issues with /g flag
  return template.replace(new RegExp(VAR_PATTERN.source, "g"), (_, key: string) => {
    if (key in vars) return String(vars[key]);
    if (key in GENERATORS) return String(GENERATORS[key]!());
    if (key.startsWith("$")) throw unknownGeneratorError(key);
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
  if (step.multipart) {
    result.multipart = substituteDeep(step.multipart, vars);
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

export async function loadEnvFile(filePath: string): Promise<Record<string, string> | null> {
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

export async function listEnvFiles(dir: string): Promise<string[]> {
  try {
    const { readdir } = await import("node:fs/promises");
    const files = await readdir(dir);
    const names: string[] = [];
    for (const f of files) {
      if (f === ".env.yaml") {
        names.push("");                           // default env — empty string = no envName
      } else {
        const m = f.match(/^\.env\.(.+)\.yaml$/);
        if (m) names.push(m[1]!);
      }
    }
    return names.sort();
  } catch {
    return [];
  }
}

export async function loadEnvironment(envName?: string, searchDir: string = "."): Promise<Record<string, string>> {
  const fileName = envName ? `.env.${envName}.yaml` : ".env.yaml";

  // Try both searchDir and parent dir — env file may be in collection root while tests are in tests/ subdir
  const fileVars = await loadEnvFile(`${searchDir}/${fileName}`);
  const parentFileVars = await loadEnvFile(`${dirname(searchDir)}/${fileName}`);

  const merged = { ...parentFileVars, ...fileVars };
  // Strip reserved meta keys so they don't leak into variable substitution
  for (const key of META_KEYS) {
    delete merged[key];
  }
  return merged;
}

const META_KEYS = ["rateLimit"] as const;

export interface EnvMeta {
  rateLimit?: number;
}

async function readEnvMetaFile(filePath: string): Promise<EnvMeta | null> {
  try {
    const text = await Bun.file(filePath).text();
    const parsed = Bun.YAML.parse(text);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const obj = parsed as Record<string, unknown>;
    const meta: EnvMeta = {};
    if ("rateLimit" in obj) {
      const v = obj.rateLimit;
      if (typeof v === "number" && Number.isFinite(v) && v > 0) {
        meta.rateLimit = v;
      } else if (typeof v === "string") {
        const n = Number.parseFloat(v);
        if (Number.isFinite(n) && n > 0) meta.rateLimit = n;
      }
    }
    return meta;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") return null;
    return null;
  }
}

export async function loadEnvMeta(envName?: string, searchDir: string = "."): Promise<EnvMeta> {
  const fileName = envName ? `.env.${envName}.yaml` : ".env.yaml";
  const parent = await readEnvMetaFile(`${dirname(searchDir)}/${fileName}`);
  const own = await readEnvMetaFile(`${searchDir}/${fileName}`);
  return { ...(parent ?? {}), ...(own ?? {}) };
}
