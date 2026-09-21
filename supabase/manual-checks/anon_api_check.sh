#!/usr/bin/env bash
# Confirms through the real REST API (local Supabase) that the anon key can't read tables or call RPCs, except
# the take list token RPCs, which work only with a valid token.
# Usage: bash supabase/manual-checks/anon_api_check.sh   (requires `supabase start` and the seed household)
set -euo pipefail

API="${API:-http://127.0.0.1:55321}"
DB_URL="${DB_URL:-postgresql://postgres:postgres@127.0.0.1:55322/postgres}"
HOUSEHOLD="${HOUSEHOLD:-aaaaaaaa-0000-0000-0000-000000000001}"
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

status=$(curl -s -o /dev/null -w '%{http_code}' "$API/rest/v1/calendar_connections?select=id,label" -H "apikey: $KEY" -H "Authorization: Bearer $KEY")
check "anon selects calendar_connections" 401 "$status"

status=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/rest/v1/rpc/svc_calendar_secret" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"p_connection_id":"00000000-0000-0000-0000-000000000000"}')
check "anon calls svc_calendar_secret" 401 "$status"

status=$(curl -s -o /dev/null -w '%{http_code}' "$API/rest/v1/household_exports?select=id" -H "apikey: $KEY" -H "Authorization: Bearer $KEY")
check "anon selects household_exports" 401 "$status"

status=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/rest/v1/rpc/request_household_export" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d "{\"p_household_id\":\"$HOUSEHOLD\"}")
check "anon calls request_household_export" 401 "$status"

status=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/rest/v1/rpc/svc_mark_export_ready" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"p_export_id":"00000000-0000-0000-0000-000000000000","p_storage_path":"x"}')
check "anon calls svc_mark_export_ready" 401 "$status"

status=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/rest/v1/rpc/svc_claim_weather_attempt" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d "{\"p_household_id\":\"$HOUSEHOLD\"}")
check "anon calls svc_claim_weather_attempt" 401 "$status"

status=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/storage/v1/object/household-photos/$HOUSEHOLD/00000000-0000-0000-0000-000000000000.thumb.jpg" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H 'Content-Type: image/jpeg' --data-binary 'x')
check "anon uploads a photo thumbnail (refused)" 400/403 "$([[ "$status" == 400 || "$status" == 403 ]] && echo 400/403 || echo "$status")"

status=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/storage/v1/object/list/exports" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' -d "{\"prefix\":\"$HOUSEHOLD\"}")
body=$(curl -s -X POST "$API/storage/v1/object/list/exports" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' -d "{\"prefix\":\"$HOUSEHOLD\"}")
check "anon lists exports bucket objects (none visible)" "200 []" "$status $body"

status=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/rest/v1/rpc/create_household" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"p_name":"X","p_time_zone":"America/New_York","p_zip":"28202","p_lat":null,"p_lon":null,"p_invite_code":"ROOST1","p_display_name":"X","p_color":"#2C7F8C"}')
check "anon calls create_household" 401 "$status"

# Take list: a link for the seed household, inserted directly (only its hash is stored; any active link is revoked) and removed afterwards.
token=$(openssl rand -base64 32 | tr '+/' '-_' | tr -d '=\n')
link_id=$(psql "$DB_URL" -v ON_ERROR_STOP=1 -Atq -v token="$token" -v household="$HOUSEHOLD" <<'SQL'
update public.take_list_links set revoked_at = now() where household_id = :'household' and revoked_at is null;
insert into public.take_list_links (household_id, token_hash, expires_at)
values (:'household', encode(extensions.digest(:'token', 'sha256'), 'hex'), now() + interval '1 hour') returning id;
SQL
)
trap 'psql "$DB_URL" -Atqc "delete from public.take_list_links where id = '"'"'$link_id'"'"'" >/dev/null' EXIT

status=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/rest/v1/rpc/take_list_items" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d "{\"p_token\":\"$token\"}")
check "anon lists take list items with a valid token" 200 "$status"

status=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/rest/v1/rpc/take_list_items" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"p_token":"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"}')
[[ "$status" == 401 || "$status" == 403 ]] && status="401/403"
check "anon lists take list items with an invalid token" "401/403" "$status"

status=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/rest/v1/rpc/create_take_list_link" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d "{\"p_household_id\":\"$HOUSEHOLD\"}")
check "anon calls create_take_list_link" 401 "$status"

# The PIN-authorised owner actions a display offers (migration 14): the PIN is checked inside the RPC, but anon
# may not reach it at all.
status=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/rest/v1/rpc/revoke_display_pin" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"p_membership_id":"bbbbbbbb-0000-0000-0000-000000000001","p_pin":"1234","p_display_id":"00000000-0000-0000-0000-000000000000"}')
check "anon calls revoke_display_pin" 401 "$status"

status=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$API/rest/v1/rpc/delete_household_pin" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H 'Content-Type: application/json' \
  -d '{"p_membership_id":"bbbbbbbb-0000-0000-0000-000000000001","p_pin":"1234","p_confirm_name":"Rivera"}')
check "anon calls delete_household_pin" 401 "$status"

exit $fail
