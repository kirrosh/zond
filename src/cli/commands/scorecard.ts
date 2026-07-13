import type { Command } from "commander";
import { loadCoverage } from "../../core/coverage/loader.ts";
import { computeScorecard, formatScorecardLine } from "../../core/coverage/scorecard.ts";
import { findCollectionByNameOrId, getLatestRunByCollection } from "../../db/queries.ts";
import { getCheckFindingsByRunIds, getPreviousScanFindingCount } from "../../db/check-findings.ts";
import { printError } from "../output.ts";
import { writeEnvelope } from "../json-envelope.ts";
import { globalJson } from "../resolve.ts";

export interface ScorecardOptions {
  apiName: string;
  /** Fold a specific session's runs instead of the latest scan's. */
  session?: string;
  json?: boolean;
  workspaceRoot?: string;
}

export async function scorecardCommand(options: ScorecardOptions): Promise<number> {
  try {
    const collection = findCollectionByNameOrId(options.apiName);
    if (!collection) {
      const msg = `API '${options.apiName}' is not registered. Run \`zond add api --spec <path>\`.`;
      if (options.json) return writeEnvelope("scorecard", { ok: false, errors: [msg] });
      printError(msg);
      return 2;
    }

    // Default to the latest scan as a whole: a full audit produces several runs
    // (test / probe / check) under one session, so fold the session rather than
    // a single run. Fall back to the latest run's own scope when it has no
    // session id (an ad-hoc `zond run`).
    let sessionId = options.session;
    if (!sessionId) {
      const latest = getLatestRunByCollection(collection.id, { runKind: "any" });
      sessionId = latest?.session_id ?? undefined;
    }

    const cov = await loadCoverage({
      apiName: options.apiName,
      scope: "audit",
      sessionId,
      workspaceRoot: options.workspaceRoot,
    });

    if (cov.runs.length === 0) {
      const hint = `No runs recorded for '${cov.apiName}' yet — run \`zond audit --api ${cov.apiName}\` (or \`zond run\`) first.`;
      if (options.json) return writeEnvelope("scorecard", { ok: false, errors: [hint], exitCode: 4 });
      console.log(hint);
      return 0;
    }

    const runIds = cov.runs.map(r => r.id);
    const checkFindings = getCheckFindingsByRunIds(runIds);
    const prevFindings = getPreviousScanFindingCount(collection.id, runIds);
    const stats = computeScorecard(cov.matrix, cov.runs, checkFindings, prevFindings);

    if (options.json) {
      return writeEnvelope("scorecard", { ok: true, data: { api: cov.apiName, ...stats } });
    }
    console.log(`${cov.apiName}: ${formatScorecardLine(stats)}`);
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (options.json) return writeEnvelope("scorecard", { ok: false, errors: [message] });
    printError(message);
    return 2;
  }
}

export function registerScorecard(program: Command): void {
  program
    .command("scorecard")
    .description("One-line value summary of the latest scan (findings · honest-2xx · ops · time)")
    .option("--api <name>", "Registered API to summarize (apis/<name>)")
    .option("--session <id>", "Summarize a specific session's runs instead of the latest scan")
    .action(async (opts, cmd: Command) => {
      const apiName = opts.api ?? cmd.parent?.opts()?.api ?? process.env.ZOND_API;
      if (!apiName) {
        printError("scorecard needs an API: pass --api <name> (or set ZOND_API / `zond use <name>`).");
        process.exitCode = 2;
        return;
      }
      process.exitCode = await scorecardCommand({
        apiName,
        session: opts.session,
        json: globalJson(cmd),
      });
    });
}
