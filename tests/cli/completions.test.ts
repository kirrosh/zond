import { describe, test, expect } from "bun:test";
import { join } from "path";
import { buildProgram } from "../../src/cli/program.ts";
import { completionsCommand, COMPLETION_SHELLS } from "../../src/cli/commands/completions.ts";

const CLI_PATH = join(import.meta.dir, "..", "..", "src", "cli", "index.ts");

// Capture stdout from completionsCommand for unit tests
function captureStdout(fn: () => void): { exitCode: number; out: string } {
  let out = "";
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    out += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
    return true;
  }) as typeof process.stdout.write;
  let code = 0;
  try {
    fn();
    code = (process.exitCode as number | undefined) ?? 0;
  } finally {
    process.stdout.write = orig;
    process.exitCode = 0;
  }
  return { exitCode: code, out };
}

describe("completionsCommand — shells", () => {
  test("bash: contains complete -F and known commands", () => {
    const program = buildProgram();
    const { out } = captureStdout(() => completionsCommand({ shell: "bash", program }));
    expect(out).toContain("complete -F _zond_completion zond");
    expect(out).toContain("compgen -W");
    for (const cmd of ["run", "validate", "serve"]) {
      expect(out).toContain(cmd);
    }
  });

  test("zsh: contains #compdef and _arguments", () => {
    const program = buildProgram();
    const { out } = captureStdout(() => completionsCommand({ shell: "zsh", program }));
    expect(out).toContain("#compdef zond");
    expect(out).toContain("_arguments");
    expect(out).toContain("'run:Run API tests'");
  });

  test("fish: contains __fish_use_subcommand", () => {
    const program = buildProgram();
    const { out } = captureStdout(() => completionsCommand({ shell: "fish", program }));
    expect(out).toContain("__fish_use_subcommand");
    expect(out).toContain("__fish_seen_subcommand_from run");
  });

  test("COMPLETION_SHELLS lists exactly bash, zsh, fish", () => {
    expect([...COMPLETION_SHELLS]).toEqual(["bash", "zsh", "fish"]);
  });
});

describe("completions command via real process (smoke)", () => {
  async function runCli(args: string[]): Promise<{ exitCode: number; stdout: string; stderr: string }> {
    const proc = Bun.spawn(["bun", CLI_PATH, ...args], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    const exitCode = await proc.exited;
    return { exitCode, stdout, stderr };
  }

  test("zond completions zsh exits 0 with non-trivial output", async () => {
    const { exitCode, stdout } = await runCli(["completions", "zsh"]);
    expect(exitCode).toBe(0);
    expect(stdout.length).toBeGreaterThan(100);
    expect(stdout).toContain("#compdef zond");
  });

  test("zond completions bash exits 0", async () => {
    const { exitCode, stdout } = await runCli(["completions", "bash"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("complete -F");
  });

  test("zond completions fish exits 0", async () => {
    const { exitCode, stdout } = await runCli(["completions", "fish"]);
    expect(exitCode).toBe(0);
    expect(stdout).toContain("__fish_use_subcommand");
  });

  test("unsupported shell exits 2", async () => {
    const { exitCode, stderr } = await runCli(["completions", "powershell"]);
    expect(exitCode).toBe(2);
    expect(stderr.toLowerCase()).toContain("unsupported");
  });

  test("missing shell argument exits 2 (commander)", async () => {
    const { exitCode } = await runCli(["completions"]);
    expect(exitCode).toBe(2);
  });
});
