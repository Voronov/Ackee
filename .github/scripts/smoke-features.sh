#!/bin/sh
# Checks what a stand does for a signed-in user, after smoke.sh said it is up. Only reads.
#
#   SMOKE_USER=... SMOKE_PASSWORD=... [SMOKE_METRICS_TOKEN=...] .github/scripts/smoke-features.sh https://dev.ackee2.varlex.app
#
# Without SMOKE_USER and SMOKE_PASSWORD it does nothing, so a stand without a test user (live)
# is not held back. A broken feature fails the run; a Google answer that is not ours only warns.
set -eu

URL=${1:?usage: smoke-features.sh <url>}

if [ -z "${SMOKE_USER:-}" ] || [ -z "${SMOKE_PASSWORD:-}" ]; then
  echo "SMOKE_USER or SMOKE_PASSWORD is not set, skipping the feature checks"
  exit 0
fi

failed=0
fail() {
  echo "::error::$1"
  failed=1
}

api() {
  curl -s --max-time 20 -X POST "$URL/api" -H 'Content-Type: application/json' ${2:+-H "Authorization: Bearer $2"} -d "$1"
}

login=$(jq -n --arg u "$SMOKE_USER" --arg p "$SMOKE_PASSWORD" \
  '{query:"mutation($i: CreateTokenInput!){createToken(input:$i){payload{id}}}",variables:{i:{username:$u,password:$p}}}')
token=$(api "$login" | jq -r '.data.createToken.payload.id // empty')

if [ -z "$token" ]; then
  fail "the test user could not sign in on $URL"
  exit 1
fi

# The token is made for this run, so it is deleted again
trap 'api "{\"query\":\"mutation { deleteToken(id: \\\"$token\\\") { success } }\"}" "$token" >/dev/null || true' EXIT

# ACKEE_SECRET_KEY is set: without it no GA4 key can be kept
if [ "$(api '{"query":"{ ga4Available }"}' "$token" | jq -r '.data.ga4Available // empty')" = true ]; then
  echo "ok   ga4Available"
else
  fail "ga4Available is not true: ACKEE_SECRET_KEY is missing on $URL"
fi

# A failed sync is Google's answer or the property's, not a broken deploy: warn only
errors=$(api '{"query":"{ domains { title ga4 { lastError } } }"}' "$token" | jq -r '.data.domains[]? | select(.ga4.lastError != null) | "\(.title): \(.ga4.lastError)"')
if [ -z "$errors" ]; then
  echo "ok   GA4 syncs without errors"
else
  echo "::warning::GA4 sync failed for $errors"
fi

# The live feed opens and says it is an event stream. curl stops it after the headers.
live=$(curl -s -o /dev/null --max-time 4 -w '%{http_code} %{content_type}' -H "Authorization: Bearer $token" "$URL/api/live" || true)
case "$live" in
  '200 text/event-stream'*) echo "ok   live feed opens" ;;
  *) fail "the live feed answered '$live' instead of 200 text/event-stream" ;;
esac

if [ -n "${SMOKE_METRICS_TOKEN:-}" ]; then
  code=$(curl -s -o /dev/null --max-time 20 -w '%{http_code}' -H "Authorization: Bearer $SMOKE_METRICS_TOKEN" "$URL/metrics" || true)
  if [ "$code" = 200 ]; then
    echo "ok   /metrics answers with its token"
  else
    fail "/metrics answered $code with the token"
  fi
fi

exit "$failed"
