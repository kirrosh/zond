-- ARV-439 (m-29): persist depth-check findings, not just HTTP touches.
--
-- Before this, `checks run` persisted a `run_kind='check'` run recording
-- every HTTP touch (audit/persist.ts) but NOT the findings themselves — those
-- lived only in the command's stdout. So `zond scorecard` reported 0 findings
-- on an audit that found real drift, and `zond-triage` / "what failed last run"
-- only worked off fresh stdout. This table stores each finding keyed by run_id.
--
-- Litmus: check_name/severity/kind are DETERMINISTIC attributes the check
-- already emits (fixed mapping, closed enum) — this is plumbing, not the
-- agent's severity judgment. `suppressed` mirrors the CI-gate exclusion
-- (ARV-307 broken-baseline) so headline counts can match the gate.
CREATE TABLE IF NOT EXISTS check_findings (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id             INTEGER NOT NULL,
  check_name         TEXT NOT NULL,
  severity           TEXT NOT NULL,
  category           TEXT,
  method             TEXT,
  path               TEXT,
  status             INTEGER,
  message            TEXT,
  recommended_action TEXT,
  suppressed         INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_check_findings_run ON check_findings(run_id);
