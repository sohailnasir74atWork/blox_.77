#!/usr/bin/env bash
#
# Apply supabase/041_birthday_short_list.sql (short Birthdays list, Wish
# everyone, Thank everyone, limit 100) to the LINKED Supabase project
# (supabase/.temp/project-ref) in one transaction, then check it.
# Port of adoptme-jan7/scripts/birthdays/apply056.sh, but through the
# Supabase CLI login (Keychain): the old ~/.supabase/access-token is stale.
# Tested first: node scripts/birthdays/test041.mjs
#
#   ./scripts/birthdays/apply041.sh           # apply, then check
#   ./scripts/birthdays/apply041.sh --check   # read-only check
#
# If the CLI says it is not logged in:  npx supabase@2.120.0 login
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
SQL_FILE="$ROOT/supabase/041_birthday_short_list.sql"
[ -s "$ROOT/supabase/.temp/project-ref" ] || { echo "✖ project not linked (supabase/.temp/project-ref)." >&2; exit 1; }
[ -s "$SQL_FILE" ] || { echo "✖ $SQL_FILE not found." >&2; exit 1; }
cd "$ROOT"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
run_file() { npx -y supabase@2.120.0 db query --linked -f "$1" 2>&1 | grep -vE '"boundary"|"warning"|Initialising'; }

cat > "$TMP/check.sql" <<'SQL'
select p.proname as fn,
       has_function_privilege('anon', p.oid, 'execute') as anon,
       has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
       (select count(*) from information_schema.columns where table_schema='public' and table_name='birthday_wishes'
         and column_name in ('thanked_at','thank_pushed_at')) as thank_cols,
       position('>= 100' in (select prosrc from pg_proc where proname='send_birthday_wish'
         and pronamespace='public'::regnamespace)) > 0 as limit_100
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and p.proname in ('list_birthdays_top', 'wish_all_birthdays', 'thank_birthday_wishers', 'send_birthday_wish',
                     'birthday_home', '_birthday_today_ranked', 'birthday_thanks_push_batch')
 order by p.proname;
SQL

if [ "${1:-}" = "--check" ]; then echo "▸ Live state (read-only)"; run_file "$TMP/check.sql"; exit 0; fi

echo "▸ Applying $(basename "$SQL_FILE") in one transaction"
{ echo 'begin;'; cat "$SQL_FILE"; echo 'commit;'; } > "$TMP/apply.sql"
run_file "$TMP/apply.sql"
echo "▸ Want 7 functions; authenticated=true and anon=false on the 5 client calls;"
echo "  both false on _birthday_today_ranked and birthday_thanks_push_batch; thank_cols=2; limit_100=true:"
run_file "$TMP/check.sql"
