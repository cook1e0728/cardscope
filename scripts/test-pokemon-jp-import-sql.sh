#!/usr/bin/env bash
# Local-only scenario tests for private.import_pokemon_jp_metadata (not in CI:
# CI has no PostgreSQL). Requires a throwaway PostgreSQL 15+ server.
#
#   PGHOST=... PGPORT=... PGUSER=postgres scripts/test-pokemon-jp-import-sql.sh [snapshot.json] [series]
#
# The script creates and drops its own database; it never touches Supabase.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
snapshot="${1:-$root/docs/evidence/pokemon-jp/SVLN-snapshot-20261001.json}"
series="${2:-SVLN}"
db="cardscope_jp_import_test_$$"
work="$(mktemp -d)"
trap 'dropdb --if-exists "$db" >/dev/null 2>&1 || true; rm -rf "$work"' EXIT

node "$root/scripts/plan-pokemon-jp-import.mjs" "$snapshot" --series "$series" > "$work/manifest.json"
node "$root/scripts/build-pokemon-jp-import-plan.mjs" "$work/manifest.json" > "$work/plan.json"

createdb "$db"
psql -q -v ON_ERROR_STOP=1 -d "$db" -f "$root/test/sql/pokemon-jp-import-fixture.sql"
psql -q -v ON_ERROR_STOP=1 -d "$db" -f "$root/supabase/migrations/20261001095010_pokemon_jp_metadata_import.sql"
# Running the migration twice proves it is re-runnable.
psql -q -v ON_ERROR_STOP=1 -d "$db" -f "$root/supabase/migrations/20261001095010_pokemon_jp_metadata_import.sql"
psql -q -v ON_ERROR_STOP=1 -d "$db" -v plan="$(cat "$work/plan.json")" -f "$root/test/sql/pokemon-jp-import.test.sql"
