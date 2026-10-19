#!/bin/sh
# usage: tools/spike-15/k6-sql.sh <plan.json> <summary.json> [duration]
# ClickHouse is reached through the host port, the way ../bench/run.sh reaches Ackee, so B
# and C over SQL take the same path as the GraphQL runs.
set -e
DUR=${3:-30s}
mkdir -p "$(dirname "$2")"
PLAN_DIR=$(cd "$(dirname "$1")" && pwd)
SUMMARY_DIR=$(cd "$(dirname "$2")" && pwd)
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
docker run --rm -i \
  -v "$SCRIPT_DIR:/script:ro" -v "$PLAN_DIR:/plan:ro" -v "$SUMMARY_DIR:/summary" \
  -e PLAN="/plan/$(basename "$1")" -e DURATION="$DUR" \
  -e CH_URL="${CH_URL:-http://host.docker.internal:8124}" -e CH_USER="${CH_USER:-default}" -e CH_PASSWORD="${CH_PASSWORD:-bench}" \
  grafana/k6 run --summary-export "/summary/$(basename "$2")" /script/k6-sql.js 2>&1 \
  | grep -E "http_req_duration|http_reqs|http_req_failed|checks|✓|✗"
