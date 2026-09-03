#!/usr/bin/env bash
# verify-migrations.sh
#
# Applies every migration in supabase/migrations/ in order, against a
# throwaway local Supabase instance (via the Supabase CLI + Docker), and
# fails loudly on the first one that errors. This is the only reliable way
# to confirm "all migrations run" — static review can catch missing
# IF NOT EXISTS guards, but not real ordering/dependency failures (a
# migration referencing a column/table a later migration creates, a
# trigger name collision, etc).
#
# Requirements: Docker running, Supabase CLI installed (npx supabase or
# `brew install supabase/tap/supabase`).
#
# USAGE:
#   ./scripts/verify-migrations.sh
#
# This never touches production — `supabase db reset` operates only on the
# local Docker Postgres instance the CLI spins up.

set -euo pipefail

echo "==> Starting local Supabase (throwaway instance)..."
npx supabase start

echo "==> Resetting local DB and replaying every migration in order..."
if npx supabase db reset; then
  echo ""
  echo "✅ All $(ls supabase/migrations/*.sql | wc -l | tr -d ' ') migrations applied cleanly, in order, with no errors."
else
  echo ""
  echo "❌ Migration replay failed — see the error above for which file and statement broke."
  echo "   Fix that migration, then re-run this script. Do not skip ahead:"
  echo "   every later migration assumes everything before it succeeded."
  npx supabase stop
  exit 1
fi

echo "==> Stopping local Supabase instance..."
npx supabase stop

echo "Done."
