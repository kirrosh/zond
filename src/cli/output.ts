const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";

function useColor(): boolean {
  return process.stderr.isTTY ?? false;
}

export function printError(message: string): void {
  const msg = useColor() ? `${RED}Error: ${message}${RESET}` : `Error: ${message}`;
  process.stderr.write(msg + "\n");
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
