export function isCompiledBinary(): boolean {
  return process.argv[0] === "bun" && import.meta.path.includes("~BUN");
}

export function getRuntimeInfo(): string {
  return isCompiledBinary() ? "standalone" : "bun";
}
