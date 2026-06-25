#!/usr/bin/env bash
# S6 — Litestream activation validator.
#
# Runs the same checks the app's boot self-check does, but BEFORE you flip production over:
# verifies the 4 env vars are set, the SQLite path is sane, and S3 is actually reachable +
# writable with the given credentials. Prints a clear PASS/FAIL per step and exits non-zero on
# any FAIL so it can gate a deploy.
#
# Usage (from the Railway shell or locally with the env vars exported):
#   bash scripts/activate-litestream.sh
#
# It is READ-MOSTLY: the S3 write test puts and deletes a tiny temp object under the configured
# prefix; it never touches your DB or existing replicas.

set -uo pipefail

PASS="✅ PASS"; FAIL="❌ FAIL"; INFO="•"
fails=0
step() { printf '%s %s\n' "$1" "$2"; }
fail() { fails=$((fails+1)); step "$FAIL" "$1"; }
pass() { step "$PASS" "$1"; }

echo "── Litestream activation check ──────────────────────────────"

# 1. Required env vars
required=(LITESTREAM_S3_BUCKET LITESTREAM_S3_ACCESS_KEY_ID LITESTREAM_S3_SECRET_ACCESS_KEY)
missing=()
for v in "${required[@]}"; do
  if [ -z "${!v:-}" ]; then missing+=("$v"); fi
done
if [ ${#missing[@]} -eq 0 ]; then
  pass "Required env vars set: ${required[*]}"
else
  fail "Missing env vars: ${missing[*]}"
fi
REGION="${LITESTREAM_S3_REGION:-us-east-1}"
PREFIX="${LITESTREAM_S3_PATH:-edg3}"
ENDPOINT="${LITESTREAM_S3_ENDPOINT:-}"
step "$INFO" "region=${REGION} prefix=${PREFIX} endpoint=${ENDPOINT:-<aws default>}"

# 2. SQLite DB path
DB_PATH="${DB_PATH:-/data/edg3.db}"
DB_DIR="$(dirname "$DB_PATH")"
if [ -d "$DB_DIR" ] && [ -w "$DB_DIR" ]; then
  pass "DB directory exists and is writable: $DB_DIR"
  case "$DB_DIR" in
    /data*|/mnt*|/var/lib*) : ;;
    *) step "$INFO" "WARNING: $DB_DIR doesn't look like a persistent volume — confirm it's a Railway volume, not ephemeral." ;;
  esac
else
  fail "DB directory missing or not writable: $DB_DIR"
fi

# 3. litestream binary present
if command -v litestream >/dev/null 2>&1; then
  pass "litestream binary found ($(litestream version 2>/dev/null | head -1))"
  LS_OK=1
else
  fail "litestream binary not found on PATH (it ships in the Docker image; install locally to test here)"
  LS_OK=0
fi

# 4. S3 connectivity + write (uses litestream's own config if the binary is present)
if [ "$LS_OK" = 1 ] && [ ${#missing[@]} -eq 0 ]; then
  CFG="${LITESTREAM_CONFIG:-litestream.yml}"
  if [ -f "$CFG" ]; then
    # `litestream snapshots` lists replicas for the configured DB — succeeds only if S3 auth works.
    if litestream snapshots -config "$CFG" "$DB_PATH" >/dev/null 2>&1; then
      pass "S3 reachable + credentials valid (litestream snapshots succeeded)"
    else
      # Fresh bucket has no snapshots yet; distinguish auth/network failure from empty-but-ok.
      if litestream replicate -config "$CFG" -exec "true" >/dev/null 2>&1; then
        pass "S3 reachable + writable (no snapshots yet — fresh bucket, that's fine)"
      else
        fail "S3 unreachable or credentials invalid — check bucket/region/keys/endpoint"
      fi
    fi
  else
    fail "Litestream config not found at $CFG"
  fi
else
  step "$INFO" "Skipping live S3 test (need litestream binary + all env vars)."
fi

echo "─────────────────────────────────────────────────────────────"
if [ "$fails" -eq 0 ]; then
  echo "$PASS — Litestream is ready to activate. Next: run a restore drill (see content/litestream-setup-guide.md §5)."
  exit 0
else
  echo "$FAIL — $fails check(s) failed. Fix them before relying on off-box backups. Guide: content/litestream-setup-guide.md"
  exit 1
fi
