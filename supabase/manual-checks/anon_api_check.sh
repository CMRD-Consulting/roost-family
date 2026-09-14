#!/usr/bin/env bash
# Confirms through the real REST API (local Supabase) that the anon key can't read tables or call RPCs.
# Usage: bash supabase/manual-checks/anon_api_check.sh   (requires `supabase start`)
set -euo pipefail

API="${API:-http://127.0.0.1:55321}"
KEY="${KEY:-$(supabase status -o env 2>/dev/null | sed -n 's/^ANON_KEY="\(.*\)"$/\1/p')}"
if [[ -z "$KEY" ]]; then
  echo "Could not read the anon key from supabase status" >&2
  exit 1
fi

fail=0
check() {
  local label="$1" expected="$2" actual="$3"
  if [[ "$actual" == "$expected" ]]; then
    echo "ok   $label ($actual)"
  else
    echo "FAIL $label: expected $expected, got $actual"
    fail=1
  fi
}

status=$(curl -s -o /dev/null -w '%{http_code}' "$API/rest/v1/households?select=id" -H "apikey: $KEY" -H "Authorization: Bearer $KEY")
check "anon selects households" 401 "$status"

status=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/rest/v1/rpc/verify_pin" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"p_membership_id":"bbbbbbbb-0000-0000-0000-000000000001","p_pin":"1234"}')
check "anon calls verify_pin" 401 "$status"

status=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/rest/v1/rpc/create_household" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"p_name":"X","p_time_zone":"America/New_York","p_zip":"28202","p_lat":null,"p_lon":null,"p_invite_code":"ROOST1","p_display_name":"X","p_color":"#2C7F8C"}')
check "anon calls create_household" 401 "$status"

exit $fail
