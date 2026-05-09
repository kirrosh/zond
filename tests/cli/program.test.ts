import { describe, test, expect, mock, afterEach, beforeEach } from "bun:test";
import { CommanderError } from "commander";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { buildProgram, preprocessArgv } from "../../src/cli/program.ts";
import { captureOutput } from "../_helpers/output";

afterEach(() => {
  // CLI handlers set process.exitCode = 2 on failures; leaking that to the
  // bun test runner makes the whole suite exit 2 on linux-hosted CI even
  // though all assertions passed.
  process.exitCode = 0;
});

// Parse argv synchronously by extracting the action call. We don't actually invoke action;
// instead we read the command tree and parsed options. parseAsync would call the real handlers.
async function tryParse(argv: string[]): Promise<{ ok: true } | { ok: false; code: string; message: string }> {
  const program = buildProgram();
  const { restore } = captureOutput();
  try {
    await program.parseAsync(["bun", "script.ts", ...argv]);
    return { ok: true };
  } catch (err) {
    if (err instanceof CommanderError) {
      return { ok: false, code: err.code, message: err.message };
    }
    throw err;
  } finally {
    restore();
  }
}

describe("preprocessArgv (MSYS path fix)", () => {
  test("strips MSYS prefix from --path value (separated form)", () => {
    const out = preprocessArgv([
      "bun", "script.ts", "describe", "spec.json",
      "--path", "C:/Program Files/Git/users",
    ]);
    expect(out[5]).toBe("/users");
  });

  test("strips MSYS prefix from --path=value form", () => {
    const out = preprocessArgv([
      "bun", "script.ts", "describe", "spec.json",
      "--path=C:/Program Files/Git/users",
    ]);
    expect(out[4]).toBe("--path=/users");
  });

  test("strips MSYS prefix from --json-path value", () => {
    const out = preprocessArgv([
      "bun", "script.ts", "request", "GET", "https://api/x",
      "--json-path", "C:/Program Files/Git/data/items",
    ]);
    expect(out[6]).toBe("/data/items");
  });

  test("does not touch unrelated flags", () => {
    const before = ["bun", "script.ts", "run", "tests/", "--env", "C:/Program Files/Git/staging"];
    const after = preprocessArgv(before);
    expect(after).toEqual(before);
  });

  test("does not touch already-clean paths", () => {
    const out = preprocessArgv(["bun", "script.ts", "describe", "spec.json", "--path", "/users"]);
    expect(out[5]).toBe("/users");
  });

  test("handles other MSYS prefixes (msys64, usr)", () => {
    expect(preprocessArgv(["bun", "x", "describe", "s", "--path", "C:/msys64/users"])[5]).toBe("/users");
    expect(preprocessArgv(["bun", "x", "describe", "s", "--path", "D:\\usr\\products"])[5]).toBe("/products");
  });
});

describe("buildProgram — registration", () => {
  test("does not register 'ui' or 'serve' commands", () => {
    const program = buildProgram();
    const names = program.commands.map((c) => c.name());
    expect(names).not.toContain("ui");
    expect(names).not.toContain("serve");
  });

  test("registers all user-facing commands", () => {
    const program = buildProgram();
    const names = new Set(program.commands.map((c) => c.name()));
    for (const expected of [
      "run", "validate", "ci", "coverage", "init",
      "add", "refresh-api", "doctor", "session",
      "describe", "db", "request", "generate", "catalog",
    ]) {
      expect(names.has(expected)).toBe(true);
    }
  });

  test("db has 5 nested subcommands", () => {
    const program = buildProgram();
    const db = program.commands.find((c) => c.name() === "db");
    expect(db).toBeDefined();
    const dbSubs = new Set(db!.commands.map((c) => c.name()));
    for (const expected of ["collections", "runs", "run", "diagnose", "compare"]) {
      expect(dbSubs.has(expected)).toBe(true);
    }
  });

  test("ci has init subcommand", () => {
    const program = buildProgram();
    const ci = program.commands.find((c) => c.name() === "ci");
    expect(ci?.commands.map((c) => c.name())).toContain("init");
  });

});

// (mcp-related test removed)

describe("buildProgram — repeatable flags", () => {
  // The run action fires (with no path) and prints to stderr — suppress it for cleaner output.
  test("collects multiple --tag values", () => {
    const { restore } = captureOutput();
    const program = buildProgram();
    const runCmd = program.commands.find((c) => c.name() === "run")!;
    runCmd.parse(["--tag", "a", "--tag", "b"], { from: "user" });
    restore();
    expect(runCmd.opts().tag).toEqual(["a", "b"]);
  });

  test("collects --exclude-tag values", () => {
    const { restore } = captureOutput();
    const program = buildProgram();
    const runCmd = program.commands.find((c) => c.name() === "run")!;
    runCmd.parse(["--exclude-tag", "x", "--exclude-tag", "y"], { from: "user" });
    restore();
    expect(runCmd.opts().excludeTag).toEqual(["x", "y"]);
  });

  test("collects --env-var values", () => {
    const { restore } = captureOutput();
    const program = buildProgram();
    const runCmd = program.commands.find((c) => c.name() === "run")!;
    runCmd.parse(["--env-var", "K1=V1", "--env-var", "K2=V2"], { from: "user" });
    restore();
    expect(runCmd.opts().envVar).toEqual(["K1=V1", "K2=V2"]);
  });

  test("collects multiple --header values for request", async () => {
    const program = buildProgram();
    const reqCmd = program.commands.find((c) => c.name() === "request")!;
    // request <method> <url> are required positionals — supply dummies so the
    // option parser accepts the run. Mock fetch so the action's HTTP call resolves
    // (otherwise we'd leak an unhandled rejection that fails the suite).
    const origFetch = globalThis.fetch;
    const fetchMock = mock(async () =>
      new Response(JSON.stringify({}), { status: 200, headers: { "Content-Type": "application/json" } }),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { restore } = captureOutput();
    try {
      await reqCmd.parseAsync(
        ["GET", "http://test.invalid", "--header", "A: 1", "--header", "B: 2"],
        { from: "user" },
      );
    } catch { /* opts already captured */ }
    restore();
    globalThis.fetch = origFetch;
    expect(reqCmd.opts().header).toEqual(["A: 1", "B: 2"]);
    // tryParse swallows action errors silently — assert the action actually ran.
    expect(fetchMock).toHaveBeenCalled();
  });

  test("--tag preserves commas (split happens in action)", () => {
    // Commander itself doesn't split — we test that the raw value is preserved as one entry.
    // The splitting is handled by flatSplit in the action; we cover that via end-to-end below.
    const { restore } = captureOutput();
    const program = buildProgram();
    const runCmd = program.commands.find((c) => c.name() === "run")!;
    runCmd.parse(["--tag=a,b"], { from: "user" });
    restore();
    expect(runCmd.opts().tag).toEqual(["a,b"]);
  });
});

describe("buildProgram — numeric validations (exit 2 via CommanderError)", () => {
  test("--timeout=abc rejects with exit 2", async () => {
    const result = await tryParse(["run", "tests/", "--timeout", "abc"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("commander.invalidArgument");
  });

  test("--fail-on-coverage=150 rejects (out of range)", async () => {
    const result = await tryParse([
      "coverage", "--spec", "x.json", "--tests", "y/", "--fail-on-coverage", "150",
    ]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("commander.invalidArgument");
  });

  test("--report=invalid rejects", async () => {
    const result = await tryParse(["run", "tests/", "--report", "invalid"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("commander.invalidArgument");
  });

  test("--rate-limit=abc rejects with exit 2", async () => {
    const result = await tryParse(["run", "tests/", "--rate-limit", "abc"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("commander.invalidArgument");
  });

  test("--rate-limit=0 rejects with exit 2", async () => {
    const result = await tryParse(["run", "tests/", "--rate-limit", "0"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("commander.invalidArgument");
  });
});

describe("TASK-182: zond probe umbrella + back-compat aliases", () => {
  test("`zond probe --help` lists every probe class", async () => {
    const program = buildProgram();
    const probeCmd = program.commands.find((c) => c.name() === "probe");
    expect(probeCmd).toBeDefined();
    const subs = probeCmd!.commands.map((c) => c.name()).sort();
    expect(subs).toEqual([
      "mass-assignment",
      "methods",
      "security",
      "validation",
    ]);
  });

  test("legacy probe-* top-level aliases are gone (TASK-288)", () => {
    const program = buildProgram();
    const top = program.commands.map((c) => c.name());
    for (const name of ["probe-validation", "probe-methods", "probe-mass-assignment", "probe-security"]) {
      expect(top).not.toContain(name);
    }
  });
});

describe("TASK-293: --json envelope coverage", () => {
  // Walk every leaf command (action handler attached) and assert it carries
  // the auto-attached --json flag. Two documented exclusions: `run` (uses
  // `--report json` for its bulk output, see TASK-73) and `completions`
  // (shell-completion text, not data).
  function collectLeafPaths(): string[] {
    const program = buildProgram();
    const out: string[] = [];
    function walk(cmd: import("commander").Command, prefix: string): void {
      const path = prefix ? `${prefix} ${cmd.name()}` : cmd.name();
      const hasAction = (cmd as unknown as { _actionHandler?: unknown })._actionHandler != null;
      if (hasAction && cmd.name() !== "help") out.push(path);
      for (const sub of cmd.commands) walk(sub, path);
    }
    for (const sub of program.commands) walk(sub, "");
    return out;
  }

  test("every leaf command (except `run` / `completions`) exposes --json", () => {
    const program = buildProgram();
    const skip = new Set(["run", "completions"]);
    const failures: string[] = [];

    function findLeaf(path: string[]): import("commander").Command | undefined {
      let cur: import("commander").Command | undefined = program;
      for (const seg of path) {
        cur = cur?.commands.find((c) => c.name() === seg);
        if (!cur) return undefined;
      }
      return cur;
    }

    for (const fullPath of collectLeafPaths()) {
      if (skip.has(fullPath)) continue;
      const leaf = findLeaf(fullPath.split(" "));
      const has = leaf?.options.some((o) => o.long === "--json");
      if (!has) failures.push(fullPath);
    }
    expect(failures).toEqual([]);
  });
});

describe("TASK-297: rich --help with related-skill footer", () => {
  // commander's addHelpText("after", ...) is rendered via Help.formatHelp,
  // so we capture the output from .outputHelp() (a write-to-stream call)
  // instead of helpInformation() (which returns the synchronous help text
  // before the after-hook is appended in some commander versions).
  // commander only fires the after-help text through outputHelp(), not
  // helpInformation() — capture stdout to read the full rendered help.
  function capture(cmd: import("commander").Command): string {
    let out = "";
    const orig = process.stdout.write;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      out += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
      return true;
    }) as typeof process.stdout.write;
    try {
      cmd.outputHelp();
    } finally {
      process.stdout.write = orig;
    }
    return out;
  }

  test("`zond <leaf> --help` ends with a 'Related skill: …' footer", () => {
    const program = buildProgram();
    const sample = ["doctor", "lint-spec", "discover", "validate"];
    for (const name of sample) {
      const cmd = program.commands.find((c) => c.name() === name);
      expect(cmd).toBeDefined();
      expect(capture(cmd!)).toMatch(/Related skill: skills\//);
    }
  });

  test("probe leaves point at skills/scenarios.md", () => {
    const program = buildProgram();
    const probe = program.commands.find((c) => c.name() === "probe")!;
    const security = probe.commands.find((c) => c.name() === "security")!;
    expect(capture(security)).toContain("Related skill: skills/scenarios.md");
    const ma = probe.commands.find((c) => c.name() === "mass-assignment")!;
    expect(capture(ma)).toContain("Related skill: skills/scenarios.md");
  });

  test("default leaf falls back to skills/zond.md", () => {
    const program = buildProgram();
    const valid = program.commands.find((c) => c.name() === "validate")!;
    expect(capture(valid)).toContain("Related skill: skills/zond.md");
  });
});

describe("buildProgram — unknown command", () => {
  test("foobar surfaces commander.unknownCommand", async () => {
    const result = await tryParse(["foobar"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("commander.unknownCommand");
  });

  test("'ui' is treated as unknown command (alias was removed)", async () => {
    const result = await tryParse(["ui"]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("commander.unknownCommand");
  });
});

describe("TASK-89: usage errors do not emit [zond:internal] noise", () => {
  test("unknown subcommand stderr stays clean of [zond:internal]", async () => {
    const program = buildProgram();
    const cap = captureOutput();
    try {
      await program.parseAsync(["bun", "script.ts", "this-command-does-not-exist"]);
    } catch { /* CommanderError */ }
    cap.restore();
    expect(cap.err).not.toContain("[zond:internal]");
  });

  test("invalid run path (usage error) stderr stays clean of [zond:internal]", async () => {
    const program = buildProgram();
    const cap = captureOutput();
    try {
      await program.parseAsync(["bun", "script.ts", "run", "/definitely/not/a/path-zztest"]);
    } catch { /* expected */ }
    cap.restore();
    expect(cap.err).not.toContain("[zond:internal]");
  });
});

describe("T15: zond use → zond run resolves --api from .zond/current-api", () => {
  let cwd: string;
  let originalCwd: string;

  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), "zond-current-e2e-"));
    originalCwd = process.cwd();
    process.chdir(cwd);
  });
  afterEach(() => {
    process.chdir(originalCwd);
    rmSync(cwd, { recursive: true, force: true });
  });

  async function parseCapturingErr(argv: string[]): Promise<string> {
    const captureErr: string[] = [];
    const origOut = process.stdout.write;
    const origErr = process.stderr.write;
    process.stdout.write = mock(() => true) as typeof process.stdout.write;
    process.stderr.write = mock((data: any) => {
      captureErr.push(String(data));
      return true;
    }) as typeof process.stderr.write;
    try {
      const program = buildProgram();
      await program.parseAsync(["bun", "script.ts", ...argv]);
    } catch { /* CommanderError or action errors already in captureErr */ }
    process.stdout.write = origOut;
    process.stderr.write = origErr;
    return captureErr.join("");
  }

  test("`zond run` (no args, no --api) falls back to .zond/current-api and tries to resolve it", async () => {
    mkdirSync(join(cwd, ".zond"), { recursive: true });
    writeFileSync(join(cwd, ".zond/current-api"), "definitely-not-a-real-api\n", "utf-8");
    const stderr = await parseCapturingErr(["run", "--db", join(cwd, "zond.db")]);
    // The collection lookup must have been attempted with the .zond/current-api value —
    // i.e. we reached "API '...' not found", not "Missing path argument".
    expect(stderr).toContain("definitely-not-a-real-api");
    expect(stderr).not.toContain("Missing path argument");
  });

  test("explicit path bypasses .zond/current-api fallback", async () => {
    mkdirSync(join(cwd, ".zond"), { recursive: true });
    writeFileSync(join(cwd, ".zond/current-api"), "definitely-not-a-real-api\n", "utf-8");
    const stderr = await parseCapturingErr(["run", "/no/such/dir", "--db", join(cwd, "zond.db")]);
    expect(stderr).not.toContain("definitely-not-a-real-api");
  });
});
