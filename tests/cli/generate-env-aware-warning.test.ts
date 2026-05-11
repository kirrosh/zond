/**
 * ARV-76 (feedback round-03 / F17): `zond generate` was warning
 * "1 path param(s) have no examples (id) on N endpoint(s)" even after the
 * user had filled `id` in apis/<name>/.env.yaml — the warning only looked
 * at spec-level `example` / `default`, never at the workspace env file
 * that `zond run` actually resolves placeholders from. This test pins the
 * env-aware silencer: the warning fires only when neither the spec nor
 * .env.yaml has a value for the param.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { generateCommand } from "../../src/cli/commands/generate.ts";
import { captureOutput } from "../_helpers/output";

const SPEC = {
  openapi: "3.0.0",
  info: { title: "tiny", version: "1.0" },
  servers: [{ url: "https://api.example.com" }],
  paths: {
    "/audiences/{id}": {
      get: {
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "ok" } },
      },
    },
  },
};

describe("generate: env-aware path-param warning (ARV-76)", () => {
  let workspace: string;
  let savedCwd: string;

  beforeEach(() => {
    workspace = realpathSync(mkdtempSync(join(tmpdir(), "zond-generate-arv76-")));
    writeFileSync(join(workspace, "zond.config.yml"), "version: 1\n");
    savedCwd = process.cwd();
    process.chdir(workspace);
    mkdirSync(join(workspace, "apis", "demo"), { recursive: true });
    writeFileSync(join(workspace, "apis", "demo", "spec.json"), JSON.stringify(SPEC));
  });

  afterEach(() => {
    process.chdir(savedCwd);
    rmSync(workspace, { recursive: true, force: true });
  });

  async function runGenerate(specPath: string, outDir: string): Promise<{ warnings: string[]; stdout: string; stderr: string }> {
    const cap = captureOutput();
    try {
      await generateCommand({ specPath, output: outDir, json: true });
    } finally {
      // captureOutput restore is below
    }
    const { out, err } = cap;
    cap.restore();
    let warnings: string[] = [];
    try {
      const envelope = JSON.parse(out);
      warnings = (envelope?.warnings as string[] | undefined) ?? [];
    } catch { /* leave warnings empty */ }
    return { warnings, stdout: out, stderr: err };
  }

  test("warning fires when neither spec example nor .env.yaml has a value", async () => {
    writeFileSync(join(workspace, "apis", "demo", ".env.yaml"), "base_url: https://api.example.com\n");
    const { warnings } = await runGenerate(
      join(workspace, "apis", "demo", "spec.json"),
      join(workspace, "apis", "demo", "tests"),
    );
    expect(warnings.some((w) => w.includes("path param(s) have no examples (id)"))).toBe(true);
  });

  test("warning is suppressed when .env.yaml has a non-empty value for the param", async () => {
    writeFileSync(
      join(workspace, "apis", "demo", ".env.yaml"),
      "base_url: https://api.example.com\nid: ab772e63-bd38-4ed8-af35-b69d6fcf5e62\n",
    );
    const { warnings } = await runGenerate(
      join(workspace, "apis", "demo", "spec.json"),
      join(workspace, "apis", "demo", "tests"),
    );
    expect(warnings.some((w) => w.includes("path param(s) have no examples"))).toBe(false);
  });

  test("placeholder-style env value ({{$uuid}}) is NOT treated as filled", async () => {
    writeFileSync(
      join(workspace, "apis", "demo", ".env.yaml"),
      "base_url: https://api.example.com\nid: \"{{$uuid}}\"\n",
    );
    const { warnings } = await runGenerate(
      join(workspace, "apis", "demo", "spec.json"),
      join(workspace, "apis", "demo", "tests"),
    );
    expect(warnings.some((w) => w.includes("path param(s) have no examples (id)"))).toBe(true);
  });
});
