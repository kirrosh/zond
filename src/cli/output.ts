const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";

function useColor(): boolean {
  return process.stderr.isTTY ?? false;
}

let debugHintShown = false;

// ARV-203: when a command catches an unexpected throw and calls
// `printError(msg, err)`, gate the stack trace behind ZOND_DEBUG=1.
// Without the env var, append a one-time hint so the user knows the
// switch exists — the previous behaviour silently dropped TypeError
// stacks and forced reverse-engineering from the bare message.
export function printError(message: string, err?: unknown): void {
  const msg = useColor() ? `${RED}Error: ${message}${RESET}` : `Error: ${message}`;
  process.stderr.write(msg + "\n");
  if (err === undefined) return;
  if (process.env.ZOND_DEBUG === "1" && err instanceof Error && err.stack) {
    process.stderr.write(err.stack + "\n");
    return;
  }
  if (!debugHintShown) {
    debugHintShown = true;
    process.stderr.write("  hint: set ZOND_DEBUG=1 to print the full stack trace.\n");
  }
}

export function printSuccess(message: string): void {
  const color = process.stdout.isTTY ?? false;
  const msg = color ? `${GREEN}${message}${RESET}` : message;
  process.stdout.write(msg + "\n");
}

export function printWarning(message: string): void {
  const msg = useColor() ? `${YELLOW}Warning: ${message}${RESET}` : `Warning: ${message}`;
  process.stderr.write(msg + "\n");
}
