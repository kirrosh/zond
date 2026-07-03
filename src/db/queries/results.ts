import { getDb, withDbRetry } from "../schema.ts";
import type { TestRunResult } from "../../core/runner/types.ts";
import { getSecretRegistry } from "../../core/secrets/registry.ts";
import type { StoredStepResult } from "./types.ts";

function parseProvenance(raw: unknown): import("../../core/parser/types.ts").SourceMetadata | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export function saveResults(runId: number, suiteResults: TestRunResult[]): void {
  const db = getDb();

  const stmt = db.prepare(`
    INSERT INTO results
      (run_id, suite_name, test_name, status, duration_ms,
       request_method, request_url, request_body,
       response_status, response_body, response_headers, error_message, assertions, captures, suite_file, provenance, failure_class, failure_class_reason, spec_pointer, spec_excerpt)
    VALUES
      ($run_id, $suite_name, $test_name, $status, $duration_ms,
       $request_method, $request_url, $request_body,
       $response_status, $response_body, $response_headers, $error_message, $assertions, $captures, $suite_file, $provenance, $failure_class, $failure_class_reason, $spec_pointer, $spec_excerpt)
  `);

  // TASK-167 (m-10): every string field that can carry a leaked secret
  // (URL with token in query, body echo on 401, Set-Cookie header, etc.)
  // goes through the registry sanitizer before INSERT.
  const reg = getSecretRegistry();
  const redactString = (s: string | null | undefined): string | null =>
    s == null ? null : reg.redact(s);
  const redactJson = (v: unknown): string | null => {
    if (v == null) return null;
    if (typeof v === "string") return reg.redact(v);
    return reg.redact(JSON.stringify(v));
  };

  withDbRetry("saveResults", () => db.transaction(() => {
    for (const suite of suiteResults) {
      for (const step of suite.steps) {
        const maxBodySize = 50_000;
        const truncBody = (s: string | null | undefined) =>
          s && s.length > maxBodySize ? s.slice(0, maxBodySize) + "\n...[truncated]" : (s ?? null);
        stmt.run({
          $run_id: runId,
          $suite_name: suite.suite_name,
          $test_name: step.name,
          $status: step.status,
          $duration_ms: step.duration_ms,
          $request_method: step.request.method,
          $request_url: redactString(step.request.url),
          $request_body: redactString(truncBody(step.request.body)),
          $response_status: step.response?.status ?? null,
          $response_body: redactString(truncBody(step.response?.body)),
          $response_headers: step.response?.headers
            ? redactJson(step.response.headers)
            : null,
          $error_message: redactString(step.error ?? null),
          $assertions: step.assertions.length > 0 ? redactJson(step.assertions) : null,
          $captures: Object.keys(step.captures).length > 0 ? redactJson(step.captures) : null,
          $suite_file: suite.suite_file ?? null,
          $provenance: step.provenance ? JSON.stringify(step.provenance) : null,
          $failure_class: step.failure_class ?? null,
          $failure_class_reason: step.failure_class_reason ?? null,
          $spec_pointer: step.spec_pointer ?? null,
          $spec_excerpt: redactString(step.spec_excerpt ?? null),
        });
      }
    }
  })());
}

export function getResultsByRunId(runId: number): StoredStepResult[] {
  const db = getDb();
  const rows = db.query("SELECT * FROM results WHERE run_id = ? ORDER BY id").all(runId) as Array<
    Omit<StoredStepResult, "assertions" | "captures" | "provenance"> & {
      assertions: string | null;
      captures: string | null;
      provenance: string | null;
    }
  >;
  return rows.map((row) => ({
    ...row,
    assertions: row.assertions ? JSON.parse(row.assertions) : [],
    captures: row.captures ? JSON.parse(row.captures) : {},
    provenance: parseProvenance(row.provenance),
  }));
}

/**
 * Row shape for the fixture-kind POST history matched by
 * `getRecentFixturePosts`'s SQL LIKE pattern (typically the
 * create-endpoint URL with `{var}` path params replaced by `%`).
 */
export interface LastFixtureAttempt {
  request_method: string;
  request_url: string;
  request_body: string | null;
  response_status: number | null;
  response_body: string | null;
  attempted_at: string;
}

/**
 * ARV-278: return the most recent N fixture-POST attempts (most recent
 * first). Powers `dump --with-last-attempt --history N` so the agent
 * sees the progression of errors as the overlay was iterated — e.g.
 * "first 400 said missing X, after fixing the body the next 400 said
 * resource_missing customer" surfaces the cascade-staleness issue (see
 * ARV-282) one level earlier than a single-snapshot view.
 */
export function getRecentFixturePosts(
  urlLikePattern: string,
  limit: number,
): LastFixtureAttempt[] {
  if (!Number.isFinite(limit) || limit <= 0) return [];
  const db = getDb();
  const rows = db.query(`
    SELECT
      r.request_method  AS request_method,
      r.request_url     AS request_url,
      r.request_body    AS request_body,
      r.response_status AS response_status,
      r.response_body   AS response_body,
      ru.started_at     AS attempted_at
    FROM results r
    JOIN runs ru ON r.run_id = ru.id
    WHERE ru.run_kind = 'fixture'
      AND r.request_method = 'POST'
      AND r.request_url LIKE ?
    ORDER BY ru.started_at DESC, r.id DESC
    LIMIT ?
  `).all(urlLikePattern, Math.floor(limit)) as LastFixtureAttempt[];
  return rows;
}

/**
 * ARV-330: like `getRecentFixturePosts` but across ALL run kinds
 * (`check`/`probe`/`run`/`request`/`fixture`). A root resource with no
 * seed_body is `skip-no-create` by prepare-fixtures, so it never records
 * a fixture-kind POST — yet a depth-check or probe may have POSTed the
 * same create-path and captured the account-level capability error. The
 * hard-blocked classifier reads this wider source so it can still
 * diagnose the gate. Caller is responsible for filtering auth-probe
 * noise (deliberately-broken-cred 401/403s).
 */
export function getRecentCreatePosts(
  urlLikePattern: string,
  limit: number,
  excludeLikePattern?: string,
): LastFixtureAttempt[] {
  if (!Number.isFinite(limit) || limit <= 0) return [];
  const db = getDb();
  // `excludeLikePattern` filters out child sub-resource POSTs in SQL (e.g.
  // `%/v1/accounts/%` drops `/v1/accounts/{id}/reject`); without it the
  // loose trailing wildcard lets a burst of probe sub-calls monopolize the
  // LIMIT window and starve the real create-path attempts (ARV-330).
  const rows = excludeLikePattern
    ? db.query(`
        SELECT r.request_method AS request_method, r.request_url AS request_url,
               r.request_body AS request_body, r.response_status AS response_status,
               r.response_body AS response_body, ru.started_at AS attempted_at
        FROM results r JOIN runs ru ON r.run_id = ru.id
        WHERE r.request_method = 'POST' AND r.request_url LIKE ? AND r.request_url NOT LIKE ?
        ORDER BY ru.started_at DESC, r.id DESC LIMIT ?
      `).all(urlLikePattern, excludeLikePattern, Math.floor(limit))
    : db.query(`
        SELECT r.request_method AS request_method, r.request_url AS request_url,
               r.request_body AS request_body, r.response_status AS response_status,
               r.response_body AS response_body, ru.started_at AS attempted_at
        FROM results r JOIN runs ru ON r.run_id = ru.id
        WHERE r.request_method = 'POST' AND r.request_url LIKE ?
        ORDER BY ru.started_at DESC, r.id DESC LIMIT ?
      `).all(urlLikePattern, Math.floor(limit));
  return rows as LastFixtureAttempt[];
}

export function getFilteredResults(
  runId: number,
  filters: {
    method?: string;
    /** Compiled SQL fragment for the `--status` filter (TASK-140). */
    statusSql?: { sql: string; params: number[] };
  },
): StoredStepResult[] {
  const db = getDb();
  const conditions = ["run_id = ?"];
  const params: (string | number)[] = [runId];

  if (filters.method) {
    conditions.push("request_method = ?");
    params.push(filters.method.toUpperCase());
  }
  if (filters.statusSql) {
    conditions.push(filters.statusSql.sql);
    params.push(...filters.statusSql.params);
  }

  const rows = db.query(`SELECT * FROM results WHERE ${conditions.join(" AND ")} ORDER BY id`).all(...params) as Array<
    Omit<StoredStepResult, "assertions" | "captures" | "provenance"> & {
      assertions: string | null;
      captures: string | null;
      provenance: string | null;
    }
  >;
  return rows.map((row) => ({
    ...row,
    assertions: row.assertions ? JSON.parse(row.assertions) : [],
    captures: row.captures ? JSON.parse(row.captures) : {},
    provenance: parseProvenance(row.provenance),
  }));
}
