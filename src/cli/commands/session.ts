import { randomUUID } from "node:crypto";
import {
  clearCurrentSession,
  readCurrentSession,
  sessionFilePath,
  writeCurrentSession,
  type SessionRecord,
} from "../../core/context/session.ts";
import { jsonError, jsonOk, printJson } from "../json-envelope.ts";
import { printError, printSuccess } from "../output.ts";

export interface SessionStartOptions {
  label?: string;
  id?: string;
  json?: boolean;
}

export interface SessionEndOptions {
  json?: boolean;
}

export interface SessionStatusOptions {
  json?: boolean;
}

function isValidUuid(s: string): boolean {
  // Permissive — accept any RFC4122-shaped UUID (v1-v8) and zero-UUID for tests.
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

export async function sessionStartCommand(opts: SessionStartOptions): Promise<number> {
  const existing = readCurrentSession();
  if (existing) {
    const message = `Session already active (${existing.id}). Run 'zond session end' first.`;
    if (opts.json) printJson(jsonError("session", [message]));
    else printError(message);
    return 1;
  }

  let id = opts.id?.trim();
  if (id && !isValidUuid(id)) {
    const message = `Invalid --id: ${id} is not a UUID`;
    if (opts.json) printJson(jsonError("session", [message]));
    else printError(message);
    return 1;
  }
  if (!id) id = randomUUID();

  const record: SessionRecord = {
    id,
    label: opts.label?.trim() || undefined,
    started_at: new Date().toISOString(),
  };

  let path: string;
  try {
    path = writeCurrentSession(record);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (opts.json) printJson(jsonError("session", [message]));
    else printError(message);
    return 1;
  }

  if (opts.json) {
    printJson(jsonOk("session", { action: "started", ...record, path }));
  } else {
    printSuccess(`Session ${record.id} started${record.label ? ` (${record.label})` : ""}`);
    process.stdout.write(`  All subsequent 'zond run' calls in this workspace inherit this session_id.\n`);
    process.stdout.write(`  Stored at ${path}. Run 'zond session end' to clear.\n`);
  }
  return 0;
}

export async function sessionEndCommand(opts: SessionEndOptions): Promise<number> {
  const existing = readCurrentSession();
  const path = sessionFilePath();
  const removed = clearCurrentSession();

  if (opts.json) {
    printJson(jsonOk("session", {
      action: "ended",
      removed,
      previous_id: existing?.id ?? null,
      path,
    }));
    return 0;
  }

  if (!removed) {
    process.stdout.write(`No active session (${path} not present).\n`);
    return 0;
  }
  printSuccess(`Session ${existing?.id ?? "(unknown)"} ended`);
  return 0;
}

export async function sessionStatusCommand(opts: SessionStatusOptions): Promise<number> {
  const record = readCurrentSession();
  const path = sessionFilePath();
  const env = process.env.ZOND_SESSION_ID?.trim() || null;

  if (opts.json) {
    printJson(jsonOk("session", {
      action: "status",
      active: !!record,
      session: record,
      env_session_id: env,
      path,
    }));
    return 0;
  }

  if (record) {
    process.stdout.write(`session_id: ${record.id}\n`);
    if (record.label) process.stdout.write(`label:      ${record.label}\n`);
    process.stdout.write(`started_at: ${record.started_at}\n`);
    process.stdout.write(`path:       ${path}\n`);
    if (env && env !== record.id) {
      process.stdout.write(`\nNote: ZOND_SESSION_ID is set to '${env}' and overrides the file.\n`);
    }
    return 0;
  }

  if (env) {
    process.stdout.write(`No active session file. ZOND_SESSION_ID is set to '${env}' (env wins).\n`);
    return 0;
  }
  process.stdout.write(
    `No active session. Run 'zond session start' to group subsequent 'zond run' calls.\n`,
  );
  return 0;
}

import type { Command } from "commander";
import { globalJson } from "../resolve.ts";

export function registerSession(program: Command): void {
  // Group multiple `zond run` calls under one session_id without juggling env
  // vars. `start` writes a UUID to .zond/current-session; subsequent `run`
  // calls auto-pick it up (priority: --session-id flag > ZOND_SESSION_ID env
  // > current-session file).
  const session = program.command("session").description("Manage run grouping (campaigns)");
  session
    .command("start")
    .description("Begin a session — group all subsequent 'zond run' calls under one session_id (.zond/current-session)")
    .option("--label <text>", "Optional human-readable label shown alongside the session in the UI")
    .option("--id <uuid>", "Reuse a specific UUID instead of generating one (useful for CI)")
    .action(async (opts, cmd: Command) => {
      process.exitCode = await sessionStartCommand({
        label: opts.label,
        id: opts.id,
        json: globalJson(cmd),
      });
    });
  session
    .command("end")
    .description("End the current session — remove .zond/current-session")
    .action(async (_opts, cmd: Command) => {
      process.exitCode = await sessionEndCommand({ json: globalJson(cmd) });
    });
  session
    .command("status")
    .description("Show the active session (if any)")
    .action(async (_opts, cmd: Command) => {
      process.exitCode = await sessionStatusCommand({ json: globalJson(cmd) });
    });
}
