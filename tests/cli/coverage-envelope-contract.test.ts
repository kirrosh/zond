/**
 * ARV-303: coverage envelope/exit-code contract.
 *
 * When the selector resolves to zero runs (closed session, no runs with the
 * requested tag, etc.), `zond coverage --json` must emit ok:false (not
 * ok:true) so the non-zero exit lines up with the envelope shape. Same
 * for the spec-only fallback (no registered API).
 */
import { describe, test, expect, beforeEach } from "bun:test";
import { writeFile, mkdir, rm } from "fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("ARV-303: coverage envelope contract on the empty / no-runs path", () => {
  let dir: string;

  beforeEach(async () => {
    dir = join(tmpdir(), `zond-arv303-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    await mkdir(dir, { recursive: true });
  });

  test("spec-only (no registered API): ok=false + exit 1, errors[] explains the fix", async () => {
    const specPath = join(dir, "spec.json");
    await writeFile(specPath, JSON.stringify({
      openapi: "3.0.3",
      info: { title: "t", version: "1" },
      paths: { "/things": { get: { responses: { "200": { description: "ok" } } } } },
    }));

    const proc = Bun.spawn(
      ["bun", "run", "src/cli/index.ts", "coverage", "--spec", specPath, "--json"],
      { cwd: process.cwd(), stdout: "pipe", stderr: "pipe" },
    );
    const stdout = await new Response(proc.stdout).text();
    const exit = await proc.exited;

    expect(exit).toBe(1);
    const envelope = JSON.parse(stdout) as { ok: boolean; errors: Array<{ message: string }> };
    expect(envelope.ok).toBe(false);
    expect(envelope.errors[0]?.message).toMatch(/registered API|zond add api/i);

    await rm(dir, { recursive: true, force: true }).catch(() => {});
  });
});
