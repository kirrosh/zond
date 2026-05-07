import { describe, test, expect } from "bun:test";
import { CommanderError } from "commander";
import { buildProgram } from "../../src/cli/program.ts";
import { completionsCommand, COMPLETION_SHELLS } from "../../src/cli/commands/completions.ts";
import { captureOutput } from "../_helpers/output";

// Capture stdout from completionsCommand for unit tests
function captureStdout(fn: () => void): { exitCode: number; out: string } {
  const cap = captureOutput();
  let code = 0;
  try {
    fn();
    code = (process.exitCode as number | undefined) ?? 0;
  } finally {
    cap.restore();
    process.exitCode = 0;
  }
  return { exitCode: code, out: cap.out };
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
    expect(out).toContain("'run:Run API tests");
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

describe("completions command — registered action errors (in-process)", () => {
  async function tryParse(argv: string[]): Promise<{ exitCode: number; out: string; err: string }> {
    const program = buildProgram();
    const cap = captureOutput();
    let exitCode = 0;
    try {
      await program.parseAsync(["bun", "script.ts", ...argv]);
      exitCode = (process.exitCode as number | undefined) ?? 0;
    } catch (err) {
      if (err instanceof CommanderError) {
        // Mirror src/cli/index.ts: any non-help CommanderError maps to exit 2.
        exitCode = err.code === "commander.helpDisplayed" || err.code === "commander.version" || err.code === "commander.help"
          ? 0
          : 2;
      } else {
        cap.restore();
        process.exitCode = 0;
        throw err;
      }
    } finally {
      cap.restore();
      process.exitCode = 0;
    }
    return { exitCode, out: cap.out, err: cap.err };
  }

  test("unsupported shell sets exit 2 and prints 'Unsupported shell'", async () => {
    const { exitCode, err } = await tryParse(["completions", "powershell"]);
    expect(exitCode).toBe(2);
    expect(err.toLowerCase()).toContain("unsupported");
  });

  test("missing shell argument is rejected by commander (exit 2)", async () => {
    const { exitCode } = await tryParse(["completions"]);
    expect(exitCode).toBe(2);
  });
});
