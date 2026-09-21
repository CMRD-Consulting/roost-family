#!/usr/bin/env bash
# Pushes supabase/config.toml (with its [remotes.production] overrides) to the hosted project.
#   bash supabase/push-production-config.sh
# `supabase config push` run by hand has two traps, and this script closes both:
#   - from a folder without this config.toml the CLI pushes its built-in defaults, which turns off anonymous
#     sign-ins (no display can register) and blanks SMTP;
#   - [remotes.production.auth.email.smtp] reads ROOST_SMTP_* from the environment, and an unset variable is sent
#     as the literal text "env(ROOST_SMTP_…)".
# The four values live outside the repository, in ~/.config/roost/smtp.env (chmod 600):
#   ROOST_SMTP_HOST=smtp.mailgun.org
#   ROOST_SMTP_USER=postmaster@sandbox….mailgun.org
#   ROOST_SMTP_FROM=postmaster@sandbox….mailgun.org     (a bare address; the display name is in config.toml)
#   ROOST_SMTP_PASS='…'                                  (single quotes keep $ and ! as typed)
# The CLI still shows the changes and asks before applying them.
set -euo pipefail

PROJECT_REF="njhwxoybuxwwtdvebdou"
ENV_FILE="${ROOST_SMTP_ENV:-$HOME/.config/roost/smtp.env}"

fail() {
  echo "Not pushed: $1" >&2
  exit 1
}

cd "$(dirname "$0")/.."
grep -q '^\[remotes\.production\]' supabase/config.toml || fail "supabase/config.toml here has no [remotes.production] block."
[ -f "$ENV_FILE" ] || fail "$ENV_FILE does not exist (see the top of this script)."

set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a

for name in ROOST_SMTP_HOST ROOST_SMTP_USER ROOST_SMTP_FROM ROOST_SMTP_PASS; do
  value="${!name:-}"
  [ -n "$value" ] || fail "$name is empty in $ENV_FILE."
  case "$value" in
    *XXXX* | *YOUR-* | *…* | *PASTE* | *CHANGE-ME*) fail "$name in $ENV_FILE still holds a placeholder." ;;
  esac
done
[[ "$ROOST_SMTP_FROM" =~ ^[^@[:space:]\<\>\"]+@[^@[:space:]\<\>\"]+\.[A-Za-z]{2,}$ ]] ||
  fail "ROOST_SMTP_FROM must be a bare address such as postmaster@sandbox123.mailgun.org, not \"Name <address>\"."

exec supabase config push --project-ref "$PROJECT_REF" "$@"
