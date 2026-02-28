import { createInterface } from "readline";
import { runAgentTurn } from "../core/agent/agent-loop.ts";
import { trimContext } from "../core/agent/context-manager.ts";
import type { AgentConfig, ToolEvent } from "../core/agent/types.ts";
import type { ModelMessage } from "ai";

// ── ANSI helpers ──
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const MAGENTA = "\x1b[35m";

// Mouse reporting escape sequences
const DISABLE_MOUSE = "\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l";
// Regex to strip mouse escape sequences from input
// Covers SGR extended, X10, urxvt mouse protocols
const MOUSE_SEQ_RE = /\x1b\[\<[\d;]*[mM]|\x1b\[M[\s\S]{3}|\x1b\[\d+;\d+;\d+M/g;

function printToolEvent(event: ToolEvent) {
  const args = Object.entries(event.args)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .slice(0, 3)
    .join(", ");

  const result = event.result as Record<string, unknown> | null;
  let summary = "done";
  if (result) {
    if ("error" in result) summary = `error: ${result.error}`;
    else if ("status" in result) summary = String(result.status);
    else if ("valid" in result) summary = result.valid ? "valid" : "invalid";
    else if ("runId" in result) summary = `run #${result.runId}`;
  }

  process.stdout.write(`  ${MAGENTA}↳ ${event.toolName}${RESET}${DIM}(${args})${RESET} → ${summary}\n`);
}

export async function startChatUI(config: AgentConfig): Promise<void> {
  const { provider } = config.provider;
  const model = config.provider.model;
  const safeLabel = config.safeMode ? ` ${YELLOW}[SAFE]${RESET}` : "";

  // Disable mouse reporting that may be left over from other TUI apps
  process.stdout.write(DISABLE_MOUSE);

  console.log(`\n${BOLD}${CYAN}apitool chat${RESET} — ${provider}/${model}${safeLabel}`);
  console.log(`${DIM}Commands: /clear, /tokens, /quit  |  Ctrl+C to exit${RESET}\n`);

  const messages: ModelMessage[] = [];
  let totalIn = 0;
  let totalOut = 0;
  let busy = false;

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: `${BOLD}${CYAN}> ${RESET}`,
    terminal: true,
  });

  rl.prompt();

  rl.on("line", async (raw: string) => {
    // Strip mouse escape sequences that leak into input
    const text = raw.replace(MOUSE_SEQ_RE, "").trim();

    if (!text || busy) {
      if (!busy) rl.prompt();
      return;
    }

    if (text === "/quit" || text === "/exit") {
      rl.close();
      return;
    }

    if (text === "/clear") {
      messages.length = 0;
      totalIn = 0;
      totalOut = 0;
      console.log(`${DIM}Conversation cleared.${RESET}\n`);
      rl.prompt();
      return;
    }

    if (text === "/tokens") {
      console.log(`${DIM}Tokens: ${totalIn} in / ${totalOut} out${RESET}\n`);
      rl.prompt();
      return;
    }

    busy = true;
    messages.push({ role: "user", content: text });

    // Trim context if conversation is long
    const trimmed = trimContext(
      messages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: typeof m.content === "string" ? m.content : "",
      })),
    );

    process.stdout.write(`\n${DIM}thinking...${RESET}`);

    try {
      const result = await runAgentTurn(
        trimmed.map((m) => ({ role: m.role, content: m.content })),
        config,
        (event) => {
          process.stdout.write(`\r\x1b[K`);
          printToolEvent(event);
          process.stdout.write(`${DIM}thinking...${RESET}`);
        },
      );

      process.stdout.write(`\r\x1b[K`);

      const responseText = result.text || "(no response)";
      console.log(`\n${GREEN}${BOLD}AI${RESET} ${responseText}\n`);

      totalIn += result.inputTokens;
      totalOut += result.outputTokens;
      messages.push({ role: "assistant", content: responseText });
    } catch (err) {
      process.stdout.write(`\r\x1b[K`);
      console.log(`\n${YELLOW}Error: ${(err as Error).message}${RESET}\n`);
    }

    busy = false;
    rl.prompt();
  });

  rl.on("close", () => {
    // Disable mouse reporting on exit too
    process.stdout.write(DISABLE_MOUSE);
    console.log(`\n${DIM}Bye! (${totalIn} in / ${totalOut} out tokens)${RESET}`);
    process.exit(0);
  });

  // Also disable mouse on SIGINT
  process.on("SIGINT", () => {
    process.stdout.write(DISABLE_MOUSE);
    rl.close();
  });

  await new Promise<void>(() => {});
}
