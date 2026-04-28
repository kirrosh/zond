import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import cliFull from "./templates/agents-cli-full.md" with { type: "text" };

export const START_MARKER = "<!-- zond:start -->";
export const END_MARKER = "<!-- zond:end -->";

export interface AgentsBlockResult {
  path: string;
  action: "created" | "updated" | "noop";
}

function blockBody(): string {
  return cliFull.trim();
}

function wrap(body: string): string {
  return `${START_MARKER}\n${body}\n${END_MARKER}`;
}

const BLOCK_RE = new RegExp(
  `${escapeRe(START_MARKER)}[\\s\\S]*?${escapeRe(END_MARKER)}`,
);

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Idempotently inserts (or updates) the zond instruction block in `<cwd>/AGENTS.md`.
 *
 * - Missing file → create with just the block.
 * - File without markers → append block at the end (preceded by `\n\n---\n\n`).
 * - File with existing markers → replace the body between them.
 * - File whose existing block already matches → noop.
 */
export function upsertAgentsBlock(cwd: string): AgentsBlockResult {
  const path = join(cwd, "AGENTS.md");
  const next = wrap(blockBody());

  if (!existsSync(path)) {
    writeFileSync(path, next + "\n", "utf-8");
    return { path, action: "created" };
  }

  const current = readFileSync(path, "utf-8");

  if (BLOCK_RE.test(current)) {
    const updated = current.replace(BLOCK_RE, next);
    if (updated === current) return { path, action: "noop" };
    writeFileSync(path, updated, "utf-8");
    return { path, action: "updated" };
  }

  // Append with separator
  const sep = current.endsWith("\n") ? "\n" : "\n\n";
  const updated = current + sep + "---\n\n" + next + "\n";
  writeFileSync(path, updated, "utf-8");
  return { path, action: "updated" };
}
