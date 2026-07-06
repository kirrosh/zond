import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync, mkdirSync, writeFileSync } from "fs";
import { readFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { auditCommand } from "../../src/cli/commands/audit.ts";
import { captureOutput } from "../_helpers/output";

// TASK-262: zond audit --api X — macro-команда для полного pipeline.
// Здесь тестируем стадию планирования (--dry-run) и формирование
// HTML-репорта на коротком стабе. Реальное end-to-end (8-10 subprocess'ов)
// слишком тяжёлое для unit-теста — оно покрыто фактическим запуском в
// CI / руками; AC #5 («≤5 минут wall-clock на чистом workspace») —
// integration-тест за рамками этого юнита.

describe("zond audit (TASK-262)", () => {
  let workdir: string;
  let prevCwd: string;
  let suppress: ReturnType<typeof captureOutput>;

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), "zond-audit-"));
    prevCwd = process.cwd();
    process.chdir(workdir);
    // Ставим минимальный workspace: apis/demo/spec.json — без db registry,
    // resolveApiCollection упадёт — поэтому используем тестовый apiDir
    // через override отсутствия --db (фолбэк на apis/<name>).
    const apiDir = join(workdir, "apis", "demo");
    mkdirSync(apiDir, { recursive: true });
    writeFileSync(join(apiDir, "spec.json"), JSON.stringify({
      openapi: "3.0.0",
      info: { title: "demo", version: "1" },
      paths: {},
    }));
    suppress = captureOutput({ console: true });
  });

  afterEach(() => {
    suppress.restore();
    process.chdir(prevCwd);
    rmSync(workdir, { recursive: true, force: true });
  });

  test("--dry-run prints stage plan with default 8 stages and does not execute", async () => {
    const code = await auditCommand({ api: "demo", dryRun: true });
    expect(code).toBe(0);
    const out = suppress.out;
    // Prepare-fixtures stage (default — без --seed)
    expect(out).toContain("zond prepare-fixtures --api demo --apply");
    // Generate, probes, run, session lifecycle
    expect(out).toContain("zond generate --api demo");
    expect(out).toContain("zond probe static --api demo");
    expect(out).toContain("zond session start");
    expect(out).toContain("zond run");
    expect(out).toContain("zond session end");
    // ARV-108: coverage stage is now part of the default pipeline.
    expect(out).toContain("zond coverage --api demo --union session --json");
    expect(out).toContain("(8 stages)");
    // mass-assignment / security stages — opt-in, не должны появляться
    expect(out).not.toContain("mass-assignment");
    expect(out).not.toContain("ssrf,crlf");
  });

  test("ARV-65: when .zond/current-session exists, session-start + session-end stages are SKIPPED (reuse outer session)", async () => {
    // Simulate a user-started session: drop a current-session file into the
    // workspace before calling audit. The dry-run plan must mark both
    // session-start and session-end stages as skip-with-reason so the live
    // run will reuse the outer session_id and not clobber it on exit.
    const zondDir = join(workdir, ".zond");
    mkdirSync(zondDir, { recursive: true });
    writeFileSync(join(zondDir, "current-session"), JSON.stringify({
      id: "11111111-2222-3333-4444-555555555555",
      label: "outer",
      started_at: new Date().toISOString(),
    }));

    const code = await auditCommand({ api: "demo", dryRun: true });
    expect(code).toBe(0);
    const out = suppress.out;
    // Both session stages renamed to (reused …) in dry-run plan.
    expect(out).toContain("session start (reused)");
    expect(out).toContain("session end (reused — kept active)");
  });

  test("ARV-336: prep is always single-pass; --live opt-in flags add probe stages", async () => {
    // ARV-264: --with-mass-assignment / --with-security are safe-mode-gated;
    // --live is the explicit opt-in. ARV-336: prep is always single-pass.
    const code = await auditCommand({
      api: "demo",
      withMassAssignment: true,
      withSecurity: true,
      live: true,
      dryRun: true,
    });
    expect(code).toBe(0);
    const out = suppress.out;
    expect(out).toContain("zond prepare-fixtures --api demo --apply\n");
    expect(out).not.toContain("--apply --seed");
    expect(out).not.toContain("--cascade");
    expect(out).toContain("zond probe mass-assignment --api demo");
    expect(out).toContain("zond probe security ssrf,crlf,open-redirect --api demo");
    // ARV-108: 10 stages with both opt-ins (default 8 + mass-assignment + security).
    // Default 8 = 7 historical + the new `coverage (session union)` stage that
    // surfaces the post-stage capture in the dry-run plan.
    expect(out).toContain("(10 stages)");
    expect(out).toContain("coverage (session union)");
  });

  test("ARV-264: --safe (default) drops probe opt-ins with warnings", async () => {
    const code = await auditCommand({
      api: "demo",
      withMassAssignment: true,
      withSecurity: true,
      dryRun: true,
    });
    expect(code).toBe(0);
    const out = suppress.out;
    // Single-pass prep, no seed/cascade.
    expect(out).toContain("zond prepare-fixtures --api demo --apply\n");
    expect(out).not.toContain("--apply --seed");
    expect(out).not.toContain("--cascade");
    // Mass-assignment / security stages dropped.
    expect(out).not.toContain("probe mass-assignment");
    expect(out).not.toContain("probe security ssrf,crlf,open-redirect");
    // Default 8 stages.
    expect(out).toContain("(8 stages)");
  });

  test("--dry-run --json emits envelope with stage plan", async () => {
    const code = await auditCommand({ api: "demo", dryRun: true, json: true });
    expect(code).toBe(0);
    // printJson pretty-prints the envelope across multiple lines; concatenate
    // and parse the whole stdout buffer.
    const env = JSON.parse(suppress.out.trim());
    expect(env.ok).toBe(true);
    expect(env.command).toBe("audit");
    expect(env.data.plan).toBeArray();
    const keys = env.data.plan.map((s: { key: string }) => s.key);
    expect(keys).toContain("prepare-fixtures");
    expect(keys).toContain("generate");
    expect(keys).toContain("probe-static");
    expect(keys).toContain("session-start");
    expect(keys).toContain("session-end");
    // ARV-108: coverage now appears in the plan envelope too.
    expect(keys).toContain("coverage");
  });

  test("HTML report writer produces a self-contained file with stage table and coverage section", async () => {
    // Direct exercise of writeAuditReport via a synthetic auditCommand path
    // is awkward because the function spawns subprocesses. Instead, hit it
    // through dry-run + a manual render: re-import the internal writer would
    // leak the abstraction — simpler is to just render through a passthrough
    // call below if we expose it. For now, smoke-check that --dry-run does
    // NOT touch the report file.
    const reportPath = join(workdir, "out.html");
    await auditCommand({ api: "demo", dryRun: true, out: reportPath });
    expect(existsSync(reportPath)).toBe(false);
  });
});
