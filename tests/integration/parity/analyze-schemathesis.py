#!/usr/bin/env python3
"""
m-18 / ARV-174 — schemathesis ndjson → structured findings summary.

Reads schemathesis V4 ndjson report and emits:
  - per-check pass/fail tallies
  - unique (endpoint, check) failed pairs
  - sample failure messages per check
  - JSON output to stdout for piping into diff.ts

Usage:
  python3 analyze-schemathesis.py <ndjson-path> [--json]
"""
import json
import sys
from collections import Counter, defaultdict


def main():
    if len(sys.argv) < 2:
        print("usage: analyze-schemathesis.py <ndjson-path> [--json]", file=sys.stderr)
        sys.exit(2)

    path = sys.argv[1]
    emit_json = "--json" in sys.argv

    per_check_status = Counter()
    findings = []  # list of {endpoint, check, message, phase, case_id}
    endpoints = set()
    example_msgs = {}

    with open(path) as f:
        for line in f:
            d = json.loads(line)
            if "ScenarioFinished" not in d:
                continue
            sf = d["ScenarioFinished"]
            phase = sf.get("phase", "?")
            rec = sf.get("recorder", {}) or {}
            label = rec.get("label", "?")
            endpoints.add(label)
            for case_id, checks in (rec.get("checks") or {}).items():
                for chk in checks:
                    name = chk.get("name", "?")
                    status = chk.get("status", "?")
                    per_check_status[(name, status)] += 1
                    if status == "failure":
                        fi = chk.get("failure_info", {}) or {}
                        fail = fi.get("failure") or {}
                        msg = fail.get("message") or fi.get("message") or "?"
                        ftype = fail.get("type") or "?"
                        findings.append({
                            "endpoint": label,
                            "check": name,
                            "phase": phase,
                            "case_id": case_id,
                            "type": ftype,
                            "message": msg.splitlines()[0][:200],
                        })
                        if name not in example_msgs:
                            example_msgs[name] = msg.splitlines()[0][:140]

    unique_pairs = {(f["endpoint"], f["check"]) for f in findings}

    if emit_json:
        out = {
            "ndjson_path": path,
            "endpoints_covered": sorted(endpoints),
            "per_check": {
                chk: {
                    "fail": per_check_status.get((chk, "failure"), 0),
                    "pass": per_check_status.get((chk, "success"), 0),
                    "skip": per_check_status.get((chk, "skip"), 0),
                }
                for chk in sorted({n for (n, _) in per_check_status.keys()})
            },
            "unique_failed_pairs": len(unique_pairs),
            "findings": findings,
        }
        json.dump(out, sys.stdout, indent=2)
        return

    # Human-readable summary
    print(f"# schemathesis report summary: {path}")
    print(f"\nEndpoints covered: {len(endpoints)}")
    print(f"Total failures: {len(findings)}")
    print(f"Unique (endpoint, check) pairs: {len(unique_pairs)}\n")

    print("## Per-check")
    for chk in sorted({n for (n, _) in per_check_status.keys()}):
        f = per_check_status.get((chk, "failure"), 0)
        s = per_check_status.get((chk, "success"), 0)
        print(f"  {chk:40s} fail={f:5d}  pass={s:5d}")

    by_check = Counter(c for (_, c) in unique_pairs)
    print("\n## Unique failed (endpoint, check) pairs by check")
    for c, n in by_check.most_common():
        print(f"  {c:40s} {n:4d} endpoints")

    print("\n## Sample failure types")
    for chk, msg in example_msgs.items():
        print(f"  [{chk}] {msg}")


if __name__ == "__main__":
    main()
