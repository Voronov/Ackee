#!/bin/sh
# usage: tools/spike-15/k6-api.sh <summary.json> <base-url-for-docker> <domain> <token> <report> [duration]
# Like ../bench/run.sh for one report. k6 stops an iteration still running 30 s after the
# duration (gracefulStop), so a run against a store that cannot answer ends after a minute;
# the store may keep computing the dropped queries, restart it before the next run.
set -e
DUR=${6:-30s}
mkdir -p "$(dirname "$1")"
SUMMARY_DIR=$(cd "$(dirname "$1")" && pwd)
SCRIPT_DIR=$(cd "$(dirname "$0")" && pwd)
docker run --rm -i \
  -v "$SCRIPT_DIR:/script:ro" -v "$SUMMARY_DIR:/summary" \
  -e BASE="$2" -e DOMAIN="$3" -e TOKEN="$4" -e REPORT="$5" -e DURATION="$DUR" \
  grafana/k6 run --summary-export "/summary/$(basename "$1")" /script/k6-api.js 2>&1 \
  | grep -E "http_req_duration|http_reqs|http_req_failed|checks|iterations|interrupted|✓|✗" | grep -v "^running ("
