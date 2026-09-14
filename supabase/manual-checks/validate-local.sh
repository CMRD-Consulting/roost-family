#!/usr/bin/env bash
# Validates Roost's Supabase migrations and seed against a throwaway plain-Postgres
# database, for use when Docker (and `supabase start` / `supabase db reset`) is unavailable.
#
# Drops and recreates a database named `roost_check` on 127.0.0.1:55432, applies
# supabase/manual-checks/local_shim.sql (a minimal stand-in for the parts of Supabase's
# auth schema and roles that the migrations/seed reference), then applies every file in
# supabase/migrations/ in order, then supabase/seed.sql if it exists.
#
# NOT a replacement for testing against real Supabase.
set -euo pipefail

PGBIN="${PGBIN:-/Applications/Postgres.app/Contents/Versions/17/bin}"
PGHOST="${PGHOST:-127.0.0.1}"
PGPORT="${PGPORT:-55432}"
PGUSER="${PGUSER:-postgres}"
DB_NAME="roost_check"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MIGRATIONS_DIR="$REPO_ROOT/supabase/migrations"
SEED_FILE="$REPO_ROOT/supabase/seed.sql"
SHIM_FILE="$SCRIPT_DIR/local_shim.sql"

PSQL=("$PGBIN/psql" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -v ON_ERROR_STOP=1)

echo "==> Dropping and recreating database $DB_NAME"
"$PGBIN/psql" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -v ON_ERROR_STOP=1 -d postgres \
  -c "drop database if exists $DB_NAME;"
"$PGBIN/psql" -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -v ON_ERROR_STOP=1 -d postgres \
  -c "create database $DB_NAME;"

echo "==> Applying local_shim.sql"
"${PSQL[@]}" -d "$DB_NAME" -f "$SHIM_FILE"

echo "==> Applying migrations"
for f in "$MIGRATIONS_DIR"/*.sql; do
  echo "  -- $f"
  "${PSQL[@]}" -d "$DB_NAME" -f "$f"
done

if [ -f "$SEED_FILE" ]; then
  echo "==> Applying seed.sql"
  "${PSQL[@]}" -d "$DB_NAME" -f "$SEED_FILE"
fi

echo "==> Done. Database $DB_NAME on port $PGPORT is ready."
