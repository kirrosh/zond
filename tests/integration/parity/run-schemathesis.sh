#!/usr/bin/env bash
# m-18 / ARV-174 — schemathesis V4 baseline runner.
#
# Usage: ./run-schemathesis.sh <api> [--smoke|--full] [--report-dir <dir>]
#
# Reads spec + auth from ~/Projects/zond-test/apis/<api>/.
# Outputs ndjson + junit report to ~/Projects/zond-test/.fb-loop/parity/<api>/.

set -euo pipefail

API="${1:-}"
MODE="${2:---smoke}"

if [[ -z "$API" ]]; then
  echo "usage: $0 <api> [--smoke|--full] [--report-dir <dir>]" >&2
  exit 2
fi

API_DIR="$HOME/Projects/zond-test/apis/$API"
SPEC="$API_DIR/spec.json"
SECRETS="$API_DIR/.secrets.yaml"
ENV_YAML="$API_DIR/.env.yaml"

if [[ ! -f "$SPEC" ]]; then
  echo "error: spec not found: $SPEC" >&2
  exit 1
fi

OUT_DIR="$HOME/Projects/zond-test/.fb-loop/parity/$API"
mkdir -p "$OUT_DIR"

TS="$(date -u +%Y%m%dT%H%M%SZ)"
REPORT_NDJSON="$OUT_DIR/schemathesis-${MODE#--}-$TS.ndjson"
REPORT_JUNIT="$OUT_DIR/schemathesis-${MODE#--}-$TS.junit.xml"

# Read auth_token + base_url via python (proper yaml parsing).
read_yaml() {
  python3 -c "import sys, yaml; d = yaml.safe_load(open(sys.argv[1])) or {}; v = d.get(sys.argv[2], ''); print(v if v is not None else '')" "$1" "$2"
}

AUTH_TOKEN=""
if [[ -f "$SECRETS" ]]; then
  AUTH_TOKEN="$(read_yaml "$SECRETS" auth_token)"
fi
if [[ -z "$AUTH_TOKEN" ]]; then
  echo "error: no auth_token in $SECRETS" >&2
  exit 1
fi

BASE_URL="$(read_yaml "$ENV_YAML" base_url)"
BASE_URL="${BASE_URL:-https://us.sentry.io}"

echo ">>> schemathesis V4 parity run"
echo "    api:        $API"
echo "    spec:       $SPEC"
echo "    base_url:   $BASE_URL"
echo "    mode:       $MODE"
echo "    out:        $REPORT_NDJSON"
echo

# Smoke = restrict to a handful of read-only GET endpoints to keep rate-limit safe.
INCLUDE_ARGS=()
if [[ "$MODE" == "--smoke" ]]; then
  INCLUDE_ARGS=(
    --include-method GET
    --include-path-regex '^/api/0/organizations/(\{organization_id_or_slug\}/?(dashboards/?|projects/?|members/?|teams/?)?)?$'
  )
fi

# Phases — exclude stateful for smoke (it needs link inference + write ops).
PHASES="examples,coverage,fuzzing"
if [[ "$MODE" == "--full" ]]; then
  PHASES="examples,coverage,fuzzing,stateful"
fi

set -x
schemathesis run \
  "$SPEC" \
  --url "$BASE_URL" \
  -H "Authorization: Bearer $AUTH_TOKEN" \
  --checks all \
  --phases "$PHASES" \
  --max-failures 200 \
  --continue-on-failure \
  --workers 2 \
  --rate-limit 10/s \
  --report ndjson,junit \
  --report-dir "$OUT_DIR" \
  --report-junit-path "$REPORT_JUNIT" \
  --warnings off \
  --suppress-health-check all \
  "${INCLUDE_ARGS[@]}" \
  || true  # don't fail script on test failures — we want the report

set +x

# schemathesis writes ndjson to report-dir/<something>.jsonl by default — find it.
LATEST_NDJSON="$(ls -t "$OUT_DIR"/*.jsonl 2>/dev/null | head -n1 || true)"
if [[ -n "$LATEST_NDJSON" && "$LATEST_NDJSON" != "$REPORT_NDJSON" ]]; then
  mv "$LATEST_NDJSON" "$REPORT_NDJSON"
fi

echo
echo ">>> done. reports:"
ls -lh "$OUT_DIR" | tail -5
