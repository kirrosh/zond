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
import { listSessions, countSessions } from "../../db/queries.ts";
import { getDb } from "../../db/schema.ts";
import { parsePositiveInt } from "../argv.ts";

export interface SessionStartOptions {
  label?: string;
  id?: string;
  json?: boolean;
  /** ARV-155: replace the existing active session instead of erroring out
   *  ("Session already active …"). Useful in ralph-loop iterations where a
   *  previous turn left a stale `.zond/current-session` behind. */
  force?: boolean;
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
  if (existing && !opts.force) {
    const message =
      `Session already active (${existing.id}). Run 'zond session end' first, or pass --force to replace it.`;
    if (opts.json) printJson(jsonError("session", [message]));
    else printError(message);
    return 1;
  }
  if (existing && opts.force) {
    clearCurrentSession();
    if (!opts.json) {
      process.stdout.write(`  Replaced active session ${existing.id}${existing.label ? ` (${existing.label})` : ""}.\n`);
    }
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

// ARV-43: list past sessions surfaced from the runs table so users can
// discover session_ids for `zond coverage --union session --session-id <id>`
// without dropping into sqlite. Labels live only in .zond/current-session
// (not persisted per run), so we only show what's stored in the DB.
export interface SessionListOptions {
  limit?: number;
  json?: boolean;
  dbPath?: string;
}

export async function sessionListCommand(opts: SessionListOptions): Promise<number> {
  const limit = opts.limit ?? 20;
  let sessions: ReturnType<typeof listSessions>;
  let total: number;
  try {
    getDb(opts.dbPath);
    sessions = listSessions(limit);
    total = countSessions();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (opts.json) printJson(jsonError("session", [message]));
    else printError(message);
    return 1;
  }

  if (opts.json) {
    printJson(jsonOk("session", { action: "list", limit, total, sessions }));
    return 0;
  }

  if (sessions.length === 0) {
    process.stdout.write("No sessions recorded yet. Run 'zond session start' before 'zond run' to group runs.\n");
    return 0;
  }
  process.stdout.write(`Showing ${sessions.length} of ${total} session(s):\n\n`);
  process.stdout.write("session_id                            started_at            finished_at           runs   pass/fail/skip\n");
  for (const s of sessions) {
    const started = s.started_at ? s.started_at.replace("T", " ").slice(0, 19) : "—".padEnd(19);
    const finished = s.finished_at ? s.finished_at.replace("T", " ").slice(0, 19) : "(open)".padEnd(19);
    const runs = String(s.run_count).padStart(4);
    const counts = `${s.passed}/${s.failed}/${s.skipped}`;
    process.stdout.write(`${s.session_id}  ${started}   ${finished}   ${runs}   ${counts}\n`);
  }
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
    .option("--force", "Replace any already-active session instead of erroring out (ARV-155)")
    .action(async (opts, cmd: Command) => {
      process.exitCode = await sessionStartCommand({
        label: opts.label,
        id: opts.id,
        force: opts.force === true,
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
  // ARV-43: complete the start/end/status/list quartet so coverage --union
  // session --session-id <id> is discoverable without sqlite spelunking.
  session
    .command("list")
    .description("List recent sessions (id, started_at, finished_at, run counts) so coverage --session-id is discoverable")
    .option("--limit <n>", "Max sessions to print (default 20)", parsePositiveInt("--limit"))
    .option("--db <path>", "Path to SQLite database file")
    .action(async (opts, cmd: Command) => {
      process.exitCode = await sessionListCommand({
        limit: opts.limit,
        dbPath: opts.db,
        json: globalJson(cmd),
      });
    });
}
