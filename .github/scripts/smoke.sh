#!/bin/sh
# Checks a stand after a deploy: the page answers, the API answers without errors, the
# database is reachable and the stand runs the expected build. Only reads.
#
#   .github/scripts/smoke.sh https://dev.ackee2.varlex.app sha-1a2b3c4
#
# Retries for a while, because the container needs some seconds to start.
set -eu

URL=${1:?usage: smoke.sh <url> <expected build>}
EXPECTED=${2:?usage: smoke.sh <url> <expected build>}
TRIES=${SMOKE_TRIES:-30}
WAIT=${SMOKE_WAIT:-5}

last=''
i=0
while [ "$i" -lt "$TRIES" ]; do
  i=$((i + 1))

  page=$(curl -s -o /dev/null -w '%{http_code}' "$URL" || true)
  answer=$(curl -s -X POST "$URL/api" -H 'Content-Type: application/json' \
    -d '{"query":"{ build { id version database } }"}' || true)

  build=$(printf '%s' "$answer" | jq -r '.data.build.id // empty' 2>/dev/null || true)
  database=$(printf '%s' "$answer" | jq -r '.data.build.database // empty' 2>/dev/null || true)
  errors=$(printf '%s' "$answer" | jq -r '.errors // empty | length' 2>/dev/null || true)

  if [ "$page" = 200 ] && [ -z "$errors" ] && [ "$database" = true ] && [ "$build" = "$EXPECTED" ]; then
    echo "$URL runs $build ($(printf '%s' "$answer" | jq -r '.data.build.version')), API and database answer"
    exit 0
  fi

  # An image from before the build query (a rollback to an old tag) cannot say what it
  # is. Then the API answering is all that can be checked, and the log says so.
  if [ "$page" = 200 ] && printf '%s' "$answer" | grep -q 'Cannot query field \\"build\\"'; then
    plain=$(curl -s -X POST "$URL/api" -H 'Content-Type: application/json' -d '{"query":"{ __typename }"}' || true)

    if [ "$(printf '%s' "$plain" | jq -r '.data.__typename // empty' 2>/dev/null || true)" = Query ]; then
      echo "::warning::$URL runs an image without the build query, so the build cannot be compared with $EXPECTED"
      echo "$URL answers, API answers"
      exit 0
    fi
  fi

  last="page=$page build=${build:-?} database=${database:-?} errors=${errors:-0}"
  sleep "$WAIT"
done

echo "$URL failed the smoke test after $TRIES tries: $last (expected build $EXPECTED)"
exit 1
