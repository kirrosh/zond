import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { END_MARKER, START_MARKER, upsertAgentsBlock } from "../../../src/cli/commands/init/agents-md.ts";

describe("upsertAgentsBlock", () => {
  let cwd: string;
  beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), "zond-agents-")); });
  afterEach(() => { rmSync(cwd, { recursive: true, force: true }); });

  test("creates AGENTS.md when missing", () => {
    const r = upsertAgentsBlock(cwd, "cli");
    expect(r.action).toBe("created");
    const body = readFileSync(r.path, "utf-8");
    expect(body).toContain(START_MARKER);
    expect(body).toContain(END_MARKER);
    expect(body).toContain("Mandatory rules");
  });

  test("appends block to existing AGENTS.md without markers", () => {
    const path = join(cwd, "AGENTS.md");
    writeFileSync(path, "# Existing project guide\n\nSome notes.\n");
    const r = upsertAgentsBlock(cwd, "cli");
    expect(r.action).toBe("updated");
    const body = readFileSync(path, "utf-8");
    expect(body).toContain("# Existing project guide");
    expect(body).toContain("Some notes.");
    expect(body).toContain(START_MARKER);
    expect(body).toContain(END_MARKER);
    expect(body.indexOf(START_MARKER)).toBeGreaterThan(body.indexOf("Some notes."));
  });

  test("replaces block between existing markers", () => {
    const path = join(cwd, "AGENTS.md");
    writeFileSync(path,
      `# Project\n\n${START_MARKER}\nstale content\n${END_MARKER}\n\nMore notes.\n`);
    const r = upsertAgentsBlock(cwd, "cli");
    expect(r.action).toBe("updated");
    const body = readFileSync(path, "utf-8");
    expect(body).not.toContain("stale content");
    expect(body).toContain("Mandatory rules");
    expect(body).toContain("More notes.");
  });

  test("repeated call is noop", () => {
    upsertAgentsBlock(cwd, "cli");
    const r = upsertAgentsBlock(cwd, "cli");
    expect(r.action).toBe("noop");
  });
});
