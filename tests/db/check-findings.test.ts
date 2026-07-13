import { describe, test, expect, afterEach } from "bun:test";
import { getDb, closeDb } from "../../src/db/schema.ts";
import { tmpDb, unlinkDb as tryUnlink } from "../_helpers/tmp-db";
import {
  saveCheckFindings,
  getCheckFindingsByRunId,
  getCheckFindingsByRunIds,
} from "../../src/db/check-findings.ts";
import type { CheckFinding } from "../../src/core/checks/types.ts";

function finding(over: Partial<CheckFinding> = {}): CheckFinding {
  return {
    check: "status_code_conformance",
    severity: "low",
    operation: { path: "/pets/{id}", method: "GET" },
    request_signature: "GET /pets/{id}",
    response_summary: { status: 404 },
    message: "undeclared 404",
    ...over,
  };
}

describe("check_findings persistence (ARV-439)", () => {
  let dbPath: string | undefined;
  afterEach(() => {
    closeDb();
    if (dbPath) { tryUnlink(dbPath); dbPath = undefined; }
  });

  test("migration creates the table + index", () => {
    dbPath = tmpDb();
    const db = getDb(dbPath);
    const tbl = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='check_findings'").all();
    expect(tbl).toHaveLength(1);
    const idx = db.query("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_check_findings_run'").all();
    expect(idx).toHaveLength(1);
  });

  test("saves findings and reads them back by run id", () => {
    dbPath = tmpDb();
    const db = getDb(dbPath);
    saveCheckFindings(db, 42, [
      finding(),
      finding({ check: "response_schema_conformance", severity: "medium", category: "contract", response_summary: { status: 200 }, recommended_action: "fix_spec" }),
    ]);
    const rows = getCheckFindingsByRunId(42, db);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ run_id: 42, check_name: "status_code_conformance", severity: "low", method: "GET", path: "/pets/{id}", status: 404, suppressed: 0 });
    expect(rows[1]).toMatchObject({ check_name: "response_schema_conformance", severity: "medium", category: "contract", status: 200, recommended_action: "fix_spec" });
  });

  test("suppressed_by maps to suppressed=1", () => {
    dbPath = tmpDb();
    const db = getDb(dbPath);
    saveCheckFindings(db, 1, [finding({ suppressed_by: { source: "broken_baseline", rule_index: 0, reason: "degenerate baseline" } })]);
    expect(getCheckFindingsByRunId(1, db)[0]!.suppressed).toBe(1);
  });

  test("empty list is a no-op; empty id list returns nothing", () => {
    dbPath = tmpDb();
    const db = getDb(dbPath);
    saveCheckFindings(db, 7, []);
    expect(getCheckFindingsByRunId(7, db)).toHaveLength(0);
    expect(getCheckFindingsByRunIds([], db)).toHaveLength(0);
  });

  test("folds findings across multiple run ids", () => {
    dbPath = tmpDb();
    const db = getDb(dbPath);
    saveCheckFindings(db, 10, [finding()]);
    saveCheckFindings(db, 11, [finding(), finding()]);
    saveCheckFindings(db, 12, [finding()]);
    expect(getCheckFindingsByRunIds([10, 11], db)).toHaveLength(3);
    expect(getCheckFindingsByRunIds([12], db)).toHaveLength(1);
  });
});
