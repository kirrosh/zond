/**
 * ARV-121 (m-19): structural regression for skill code-blocks.
 *
 * Every shipped skill template (`src/cli/commands/init/templates/skills/*.md`)
 * carries copy-pasteable `zond …` snippets that agents follow verbatim.
 * m-15..m-17 closed 12 skill-drift findings point-by-point (ARV-84..93);
 * §3 of the m-19 refactor plan asks for the structural defence — a
 * test that walks every snippet and rejects unknown options /
 * commands so the next stale example can't ship undetected.
 *
 * Strategy. The test builds the real Commander program tree via
 * `buildProgram()` and, for each parsed `zond …` line, walks the tree
 * to the leaf command and verifies that every `--flag` and short
 * `-x` appears in that subcommand's option set (including options
 * inherited from `program`). Placeholders (`<name>`, `<run-id>`, …)
 * and shell substitutions (`$(jq …)`, pipes, line continuations) are
 * normalised before tokenisation. The synthetic-spec fixture under
 * `tests/fixtures/synthetic-spec/` exists for any deeper variants
 * that want to spawn real commands — this layer is purely structural
 * (per task description: "НЕ валидирует семантику — только что
 * флаги существуют и форма команды парсится").
 *
 * Authors can opt a code-block out with `<!-- skip-regression -->`
 * placed on its own line directly above the opening fence.
 *
 * AC#4 — adding `zond run --json` (deliberately rejected per TASK-134)
 * to any skill must make this test fail. The negative case is exercised
 * inline below so the regression-of-the-regression stays visible.
 */
import { describe, test, expect } from "bun:test";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Command, Option } from "commander";
import { buildProgram } from "../../src/cli/program.ts";

const REPO_ROOT = resolve(import.meta.dir, "..", "..");
const SKILLS_DIR = resolve(REPO_ROOT, "src/cli/commands/init/templates/skills");
const SYNTH_DIR = resolve(REPO_ROOT, "tests/fixtures/synthetic-spec");

// Sanity guard for AC#2: the synthetic-spec fixture must exist on
// disk even though the structural test below does not spawn commands.
test("synthetic-spec fixture is present", () => {
  expect(existsSync(join(SYNTH_DIR, "spec.json"))).toBe(true);
  expect(existsSync(join(SYNTH_DIR, ".env.yaml"))).toBe(true);
  expect(existsSync(join(SYNTH_DIR, ".api-resources.yaml"))).toBe(true);
});

interface Extracted {
  file: string;
  line: number;
  raw: string;
  tokens: string[];
}

/**
 * Parse a single skill markdown file into a list of `zond` invocations.
 * Handles:
 *   - ```bash / ```shell fenced blocks (other langs ignored);
 *   - `<!-- skip-regression -->` pragma on the line immediately above
 *     the opening fence — skips the whole block;
 *   - line continuations with trailing `\`;
 *   - inline pipes (`zond … | jq …`) — truncated at the first pipe so
 *     downstream tools don't count as zond args;
 *   - shell substitutions `$( … )` — replaced with a literal `1`;
 *   - placeholders (`<name>`, `<run-id>`, etc.) — replaced before
 *     tokenisation so the resulting argv has no angle brackets.
 */
function parseSkill(file: string): Extracted[] {
  const text = readFileSync(file, "utf-8");
  const lines = text.split("\n");
  const out: Extracted[] = [];
  let inBlock = false;
  let blockLang: string | null = null;
  let skipBlock = false;
  let buffer = "";
  let bufferLine = 0;
  // Watch the previous *non-blank* line so we can detect a skip-pragma
  // right above an opening fence regardless of trailing whitespace.
  let prevNonBlank = "";
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const trimmed = raw.trim();
    const fence = trimmed.match(/^```(\w+)?/);
    if (fence) {
      if (!inBlock) {
        const lang = (fence[1] ?? "").toLowerCase();
        if (lang === "bash" || lang === "shell" || lang === "sh") {
          inBlock = true;
          blockLang = lang;
          skipBlock = prevNonBlank === "<!-- skip-regression -->";
        } else {
          // not a shell-flavoured block — ignore the fence pair entirely
          blockLang = null;
        }
      } else {
        inBlock = false;
        blockLang = null;
        skipBlock = false;
      }
      if (trimmed) prevNonBlank = trimmed;
      continue;
    }
    if (inBlock && !skipBlock) {
      // Strip leading prompt markers; preserve indentation inside.
      const stripped = raw.replace(/^\s*\$\s+/, "");
      // Line continuation: accumulate, then process when the
      // continuation chain terminates.
      if (stripped.endsWith("\\")) {
        if (!buffer) bufferLine = i + 1;
        buffer += stripped.slice(0, -1).trim() + " ";
        continue;
      }
      const command = buffer + stripped;
      buffer = "";
      if (/^\s*zond\s/.test(command)) {
        out.push({
          file,
          line: bufferLine || i + 1,
          raw: command.trim(),
          tokens: tokenizeShell(normaliseCommand(command)),
        });
      }
    }
    if (trimmed) prevNonBlank = trimmed;
  }
  return out;
}

function normaliseCommand(cmd: string): string {
  // Truncate at the first un-quoted pipe — anything downstream
  // (`jq …`, `head -…`) is not a zond arg.
  let pipeIdx = -1;
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < cmd.length; i++) {
    const ch = cmd[i]!;
    if (ch === "\\") { i++; continue; }
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === "|" && !inSingle && !inDouble) {
      // Skip `||` (logical or) — only break on a single pipe followed
      // by something other than `|`.
      if (cmd[i + 1] !== "|") { pipeIdx = i; break; }
    }
  }
  let head = pipeIdx === -1 ? cmd : cmd.slice(0, pipeIdx);
  // Drop shell command substitutions: replace `$( … )` with `1`.
  head = head.replace(/\$\([^)]*\)/g, "1");
  // Drop backtick subshells the same way.
  head = head.replace(/`[^`]*`/g, "1");
  // Trailing comments — anything after a stand-alone `#`.
  head = head.replace(/\s+#.*$/, "");
  // Replace placeholders. The list is exhaustive over what current
  // skills carry; new placeholders should be added here when authors
  // introduce them.
  const subs: Array<[RegExp, string]> = [
    [/<name>/g, "synthapi"],
    [/<api>/g, "synthapi"],
    [/<id>/g, "1"],
    [/<idA>/g, "1"],
    [/<idB>/g, "2"],
    [/<run-id>/g, "1"],
    [/<run-id1>/g, "1"],
    [/<run-id2>/g, "2"],
    [/<class>/g, "ssrf"],
    [/<resource>/g, "users"],
    [/<spec-tag>/g, "users"],
    [/<new-spec>/g, "tests/fixtures/synthetic-spec/spec.json"],
    [/<sha>/g, "abc123"],
    [/<endpoint>/g, "GET:/users"],
    [/<file>/g, "out.json"],
    [/<path>/g, "tests/fixtures/synthetic-spec"],
    [/<dir>/g, "tests/fixtures/synthetic-spec"],
    [/<value>/g, "v"],
    [/<KEY=VALUE>/g, "K=V"],
    [/<tag>/g, "smoke"],
    [/<method>/g, "GET"],
    [/<format>/g, "json"],
    [/<N>/g, "1"],
    [/<ms>/g, "1000"],
    [/<token>/g, "tok"],
    [/<sessionId>/g, "1"],
    // Range literal `135..142` confuses tokenisation; collapse to `1..2`.
    [/\d+\.\.\d+/g, "1..2"],
  ];
  for (const [re, val] of subs) head = head.replace(re, val);
  return head.trim();
}

function tokenizeShell(s: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === "\\" && i + 1 < s.length) { cur += s[++i]; continue; }
    if (ch === "'" && !inDouble) { inSingle = !inSingle; continue; }
    if (ch === '"' && !inSingle) { inDouble = !inDouble; continue; }
    if (!inSingle && !inDouble && /\s/.test(ch)) {
      if (cur) { out.push(cur); cur = ""; }
      continue;
    }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/** Find the most specific subcommand matching `tokens` (which starts
 *  with the literal `zond`). Returns the subcommand command + the
 *  index where its args begin. */
function resolveCommand(program: Command, tokens: string[]): { cmd: Command; argsStart: number } {
  let cmd: Command = program;
  let i = 1; // skip "zond"
  while (i < tokens.length) {
    const t = tokens[i]!;
    if (t.startsWith("-")) break;
    const sub = cmd.commands.find(
      c => c.name() === t || c.aliases().includes(t),
    );
    if (!sub) break;
    cmd = sub;
    i++;
  }
  return { cmd, argsStart: i };
}

function collectFlagNames(cmd: Command): Set<string> {
  const out = new Set<string>();
  // Walk up the parent chain so options inherited from the root
  // program (`--quiet`, `--verbose`, …) are recognised. Commander 13
  // exposes `parent` on subcommands.
  let curr: Command | null = cmd;
  while (curr) {
    for (const opt of curr.options as Option[]) {
      if (opt.short) out.add(opt.short);
      if (opt.long) out.add(opt.long);
      // Negated form: --no-foo from --foo and vice-versa.
      if (opt.long) {
        if (opt.long.startsWith("--no-")) out.add("--" + opt.long.slice(5));
        else out.add("--no-" + opt.long.slice(2));
      }
    }
    // commander >=10 typed parent
    curr = (curr as Command & { parent: Command | null }).parent;
  }
  // Help is always accepted.
  out.add("--help");
  out.add("-h");
  return out;
}

function checkArgs(cmd: Command, args: string[]): { unknown: string[] } {
  const accepted = collectFlagNames(cmd);
  const unknown: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (!a.startsWith("-")) continue;
    // Combined short flags (`-xyz`) are not used by zond and we don't
    // try to be clever — long flags only.
    const flag = a.split("=")[0]!;
    if (!accepted.has(flag)) unknown.push(flag);
  }
  return { unknown };
}

/** Bring up the program once. `buildProgram` registers every probe
 *  bootstrap as a side effect; calling it twice is idempotent thanks
 *  to the bootstrap singletons. */
const PROGRAM = buildProgram();

describe("ARV-121: skill code-block regression", () => {
  const skillFiles = readdirSync(SKILLS_DIR)
    .filter(f => f.endsWith(".md"))
    .map(f => join(SKILLS_DIR, f));

  test("at least one skill template is present (sanity)", () => {
    expect(skillFiles.length).toBeGreaterThan(0);
  });

  for (const file of skillFiles) {
    const snippets = parseSkill(file);
    if (snippets.length === 0) continue;
    test(`${file.split("/").pop()} — ${snippets.length} zond snippet(s) parse cleanly`, () => {
      const failures: string[] = [];
      for (const s of snippets) {
        if (s.tokens.length < 2) continue; // just "zond" alone — `--help` form
        const { cmd, argsStart } = resolveCommand(PROGRAM, s.tokens);
        // The first non-flag token after `zond` had to resolve to a
        // known subcommand — otherwise the user can never invoke it.
        const firstNonFlag = s.tokens.slice(1).find(t => !t.startsWith("-"));
        if (firstNonFlag && cmd === PROGRAM) {
          failures.push(`L${s.line}: unknown command "${firstNonFlag}" — ${s.raw}`);
          continue;
        }
        const { unknown } = checkArgs(cmd, s.tokens.slice(argsStart));
        if (unknown.length > 0) {
          failures.push(`L${s.line}: unknown option(s) ${unknown.join(", ")} on \`${cmd.name()}\` — ${s.raw}`);
        }
      }
      expect(failures, failures.join("\n")).toEqual([]);
    });
  }
});

describe("ARV-121 negative case — broken example must be caught", () => {
  test("synthetic `zond run --json` is rejected (AC#4)", () => {
    // TASK-134: `zond run` deliberately does not accept --json. If a
    // future edit accidentally adds the option, the production guard
    // disappears — this test guards the guard.
    const { cmd, argsStart } = resolveCommand(PROGRAM, ["zond", "run"]);
    const { unknown } = checkArgs(cmd, ["zond", "run", "--json"].slice(argsStart));
    expect(unknown).toContain("--json");
  });

  test("synthetic `zond bogus-cmd` is rejected", () => {
    const { cmd } = resolveCommand(PROGRAM, ["zond", "bogus-cmd"]);
    expect(cmd).toBe(PROGRAM);
  });

  test("synthetic `zond probe security --no-such-flag` is rejected", () => {
    const tokens = ["zond", "probe", "security", "ssrf", "--no-such-flag"];
    const { cmd, argsStart } = resolveCommand(PROGRAM, tokens);
    const { unknown } = checkArgs(cmd, tokens.slice(argsStart));
    expect(unknown).toContain("--no-such-flag");
  });
});
