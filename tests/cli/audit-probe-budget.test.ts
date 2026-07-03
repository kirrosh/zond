/**
 * ARV-302: `zond audit --with-mass-assignment --with-security --budget <tier>`
 * must propagate the budget to probe stages — otherwise the probes scan
 * unbounded (3600+ mass-assignment probes against Stripe's 587 endpoints
 * silently spent 10+ minutes with no heartbeat).
 *
 * The mapping is coarse on purpose: probes scan endpoint-by-endpoint,
 * not request-by-request, so the budget tier maps to `--max-endpoints`
 * rather than `--max-requests`.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { auditCommand } from "../../src/cli/commands/audit.ts";
import { captureOutput } from "../_helpers/output";

describe("ARV-302: audit --budget propagates to probe stages", () => {
  let workdir: string;
  let prevCwd: string;
  let suppress: ReturnType<typeof captureOutput>;

  beforeEach(() => {
    workdir = mkdtempSync(join(tmpdir(), "zond-arv302-"));
    prevCwd = process.cwd();
    process.chdir(workdir);
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

  test("--budget quick + probes → both probe stages get --max-endpoints 10", async () => {
    const code = await auditCommand({
      api: "demo",
      dryRun: true,
      live: true,
      withSecurity: true,
      withMassAssignment: true,
      budget: "quick",
    });
    expect(code).toBe(0);
    const out = suppress.out;
    expect(out).toContain("probe mass-assignment");
    expect(out).toContain("--max-endpoints 10");
    expect(out).toContain("probe security ssrf,crlf,open-redirect");
    // The cap should appear next to both probe invocations.
    const occurrences = out.split("--max-endpoints 10").length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });

  test("--budget standard + probes → both probe stages get --max-endpoints 50", async () => {
    const code = await auditCommand({
      api: "demo",
      dryRun: true,
      live: true,
      withMassAssignment: true,
      budget: "standard",
    });
    expect(code).toBe(0);
    expect(suppress.out).toContain("--max-endpoints 50");
  });

  test("--budget full → probes run uncapped (no --max-endpoints flag)", async () => {
    const code = await auditCommand({
      api: "demo",
      dryRun: true,
      live: true,
      withMassAssignment: true,
      budget: "full",
    });
    expect(code).toBe(0);
    expect(suppress.out).not.toContain("--max-endpoints");
  });

  test("no --budget at all → legacy uncapped probe stages (back-compat)", async () => {
    const code = await auditCommand({
      api: "demo",
      dryRun: true,
      live: true,
      withMassAssignment: true,
    });
    expect(code).toBe(0);
    expect(suppress.out).not.toContain("--max-endpoints");
  });
});
