import { existsSync } from "fs";
import { resolve } from "path";
import { getDb, closeDb } from "../../db/schema.ts";

export interface DoctorOptions {
  dbPath?: string;
}

interface Check {
  label: string;
  ok: boolean;
  detail: string;
}

export async function doctorCommand(options: DoctorOptions): Promise<number> {
  const checks: Check[] = [];

  // 1. Database
  checks.push(checkDatabase(options.dbPath));

  // 2. Test files
  checks.push(checkTestFiles());

  // 3. OpenAPI spec
  checks.push(checkOpenApiSpec());

  // 4. Environment files
  checks.push(checkEnvFiles());

  // 5. Ollama
  checks.push(await checkOllama());

  // Print results
  console.log("\nzond doctor\n");

  let hasFailure = false;
  for (const check of checks) {
    const icon = check.ok ? "\u2713" : "\u2717";
    console.log(`  ${icon} ${check.label}: ${check.detail}`);
    if (!check.ok) hasFailure = true;
  }

  console.log("");
  if (hasFailure) {
    console.log("Some checks failed. See details above.");
  } else {
    console.log("All checks passed.");
  }

  return hasFailure ? 1 : 0;
}

function checkDatabase(dbPath?: string): Check {
  const path = dbPath ? resolve(dbPath) : resolve(process.cwd(), "zond.db");
  try {
    const db = getDb(path);
    const runs = (db.query("SELECT COUNT(*) as cnt FROM runs").get() as { cnt: number }).cnt;
    const envs = (db.query("SELECT COUNT(*) as cnt FROM environments").get() as { cnt: number }).cnt;
    closeDb();
    return { label: "Database", ok: true, detail: `${path} (${runs} runs, ${envs} environments)` };
  } catch (err) {
    return { label: "Database", ok: false, detail: `Cannot open ${path}: ${(err as Error).message}` };
  }
}

function checkTestFiles(): Check {
  const dirs = [".", "tests", "test"];
  const found: string[] = [];

  for (const dir of dirs) {
    const full = resolve(process.cwd(), dir);
    if (!existsSync(full)) continue;
    try {
      const glob = new Bun.Glob("**/*.yaml");
      for (const file of glob.scanSync({ cwd: full, absolute: false })) {
        if (!file.startsWith(".env.")) {
          found.push(`${dir}/${file}`);
        }
      }
    } catch { /* ignore */ }
  }

  if (found.length > 0) {
    return { label: "Test files", ok: true, detail: `${found.length} YAML file(s) found` };
  }
  return { label: "Test files", ok: false, detail: "No YAML test files found in cwd or tests/" };
}

function checkOpenApiSpec(): Check {
  const candidates = ["openapi.yaml", "openapi.json", "openapi.yml", "swagger.yaml", "swagger.json"];
  for (const name of candidates) {
    const full = resolve(process.cwd(), name);
    if (existsSync(full)) {
      return { label: "OpenAPI spec", ok: true, detail: name };
    }
  }
  return { label: "OpenAPI spec", ok: false, detail: "No openapi.yaml/json found (optional)" };
}

function checkEnvFiles(): Check {
  const found: string[] = [];
  try {
    const glob = new Bun.Glob(".env.*.yaml");
    for (const file of glob.scanSync({ cwd: process.cwd(), absolute: false })) {
      found.push(file);
    }
  } catch { /* ignore */ }

  if (found.length > 0) {
    return { label: "Environment files", ok: true, detail: found.join(", ") };
  }
  return { label: "Environment files", ok: false, detail: "No .env.*.yaml files found (optional)" };
}

async function checkOllama(): Promise<Check> {
  try {
    const res = await fetch("http://localhost:11434/api/tags", { signal: AbortSignal.timeout(3000) });
    if (res.ok) {
      const data = await res.json() as { models?: { name: string }[] };
      const count = data.models?.length ?? 0;
      return { label: "Ollama", ok: true, detail: `Running (${count} model(s) available)` };
    }
    return { label: "Ollama", ok: false, detail: `Responded with status ${res.status}` };
  } catch {
    return { label: "Ollama", ok: false, detail: "Not reachable at localhost:11434 (optional, needed for chat)" };
  }
}
