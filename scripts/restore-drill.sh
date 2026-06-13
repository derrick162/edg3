#!/bin/sh
# EDG3 — Litestream restore drill.
#
# Proves off-box S3 recovery works by restoring to a temp location and
# verifying integrity + row counts against the restored DB.
# Exit code: 0 = PASS, 1 = FAIL.
#
# HOW TO RUN (from Railway shell or locally with prod S3 creds):
#   sh scripts/restore-drill.sh
#
# Required env vars:
#   LITESTREAM_S3_BUCKET
#   LITESTREAM_S3_ACCESS_KEY_ID
#   LITESTREAM_S3_SECRET_ACCESS_KEY
#
# Optional env vars (same as litestream.yml):
#   LITESTREAM_S3_REGION    (default: us-east-1)
#   LITESTREAM_S3_PATH      (default: edg3)
#   LITESTREAM_S3_ENDPOINT  (Backblaze B2, Cloudflare R2, etc.)
#   LITESTREAM_VERSION      (default: 0.3.13)
#   LITESTREAM_CONFIG       (default: litestream.yml)

set -e

LITESTREAM_VERSION="${LITESTREAM_VERSION:-0.3.13}"
LITESTREAM_BIN="/tmp/litestream"
LITESTREAM_CONFIG="${LITESTREAM_CONFIG:-litestream.yml}"
RESTORE_PATH="/tmp/edg3-drill-$$.db"
VERIFY_SCRIPT="/tmp/edg3-verify-$$.mjs"

# ANSI colours (suppressed if not a tty).
if [ -t 1 ]; then
  RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BOLD='\033[1m'; NC='\033[0m'
else
  RED=''; GREEN=''; YELLOW=''; BOLD=''; NC=''
fi

info()  { printf '%b[INFO]%b  %s\n' "$YELLOW" "$NC" "$1"; }
pass()  { printf '%b[PASS]%b  %s\n' "$GREEN"  "$NC" "$1"; }
fail()  { printf '%b[FAIL]%b  %s\n' "$RED"    "$NC" "$1" >&2; exit 1; }

cleanup() { rm -f "$RESTORE_PATH" "$VERIFY_SCRIPT"; }
trap cleanup EXIT

printf '\n%bEDG3 Litestream Restore Drill%b\n' "$BOLD" "$NC"
printf '==============================\n\n'

# ── 1. Validate env ───────────────────────────────────────────────────────────
info "Checking required env vars..."
[ -z "$LITESTREAM_S3_BUCKET" ]            && fail "LITESTREAM_S3_BUCKET is not set"
[ -z "$LITESTREAM_S3_ACCESS_KEY_ID" ]     && fail "LITESTREAM_S3_ACCESS_KEY_ID is not set"
[ -z "$LITESTREAM_S3_SECRET_ACCESS_KEY" ] && fail "LITESTREAM_S3_SECRET_ACCESS_KEY is not set"
pass "Required env vars present (bucket: $LITESTREAM_S3_BUCKET)"

# ── 2. Ensure Litestream binary ───────────────────────────────────────────────
if [ -f "$LITESTREAM_BIN" ]; then
  pass "Litestream binary already cached at $LITESTREAM_BIN"
else
  info "Downloading Litestream v${LITESTREAM_VERSION}..."
  ARCH="$(uname -m)"
  case "$ARCH" in
    x86_64)  LS_ARCH="amd64" ;;
    aarch64) LS_ARCH="arm64" ;;
    *)       LS_ARCH="amd64" ;;
  esac
  TARBALL="/tmp/litestream-drill.tar.gz"
  URL="https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-v${LITESTREAM_VERSION}-linux-${LS_ARCH}.tar.gz"
  if wget -q -O "$TARBALL" "$URL" 2>/dev/null || curl -fsSL -o "$TARBALL" "$URL"; then
    tar -C /tmp -xzf "$TARBALL" && rm -f "$TARBALL" && chmod +x "$LITESTREAM_BIN"
    pass "Litestream v${LITESTREAM_VERSION} downloaded."
  else
    fail "Could not download Litestream from $URL — check connectivity."
  fi
fi

# ── 3. Restore from S3 ────────────────────────────────────────────────────────
info "Restoring from S3 bucket '$LITESTREAM_S3_BUCKET' → $RESTORE_PATH ..."
if ! "$LITESTREAM_BIN" restore -config "$LITESTREAM_CONFIG" "$RESTORE_PATH"; then
  fail "litestream restore failed — check credentials, bucket name, and that replication has been running long enough to have data."
fi

[ -f "$RESTORE_PATH" ] || fail "Restore reported success but output file is missing."

RESTORE_BYTES=$(wc -c < "$RESTORE_PATH")
[ "$RESTORE_BYTES" -lt 8192 ] && fail "Restored file is only ${RESTORE_BYTES} bytes — likely corrupt or empty."
pass "Restore complete: ${RESTORE_BYTES} bytes at $RESTORE_PATH"

# ── 4. Verify with better-sqlite3 (Node.js is always present on Railway) ─────
info "Verifying DB integrity and row counts..."

# Write an ESM verification script using the project's better-sqlite3.
cat > "$VERIFY_SCRIPT" << 'JSEOF'
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const require = createRequire(import.meta.url);
// Resolve better-sqlite3 from the project root so the native binding is found.
const projectRoot = process.argv[3] || process.cwd();
const Database = require(join(projectRoot, 'node_modules/better-sqlite3'));

const dbPath = process.argv[2];
const db = new Database(dbPath, { readonly: true });
try {
  const ic = db.prepare('PRAGMA integrity_check').get();
  const tables = ['users', 'briefings', 'calendar_tokens', 'priorities', 'memories', 'tasks'];
  const counts = {};
  for (const t of tables) {
    try { counts[t] = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n; }
    catch { counts[t] = -1; }
  }
  const ok = ic.integrity_check === 'ok';
  console.log(`INTEGRITY=${ic.integrity_check}`);
  for (const [t, n] of Object.entries(counts)) {
    console.log(`TABLE_${t.toUpperCase()}=${n}`);
  }
  process.exit(ok ? 0 : 1);
} finally {
  db.close();
}
JSEOF

PROJECT_ROOT="${PROJECT_ROOT:-/app}"
VERIFY_OUT=$(node "$VERIFY_SCRIPT" "$RESTORE_PATH" "$PROJECT_ROOT" 2>&1) || {
  fail "DB verification script failed:\n$VERIFY_OUT"
}

INTEGRITY=$(printf '%s' "$VERIFY_OUT" | grep '^INTEGRITY=' | cut -d= -f2)
USER_COUNT=$(printf '%s' "$VERIFY_OUT" | grep '^TABLE_USERS=' | cut -d= -f2)
BRIEFING_COUNT=$(printf '%s' "$VERIFY_OUT" | grep '^TABLE_BRIEFINGS=' | cut -d= -f2)

[ "$INTEGRITY" = "ok" ] || fail "PRAGMA integrity_check returned: $INTEGRITY"
pass "PRAGMA integrity_check: ok"
pass "Row counts — users: ${USER_COUNT}, briefings: ${BRIEFING_COUNT}"

# ── 5. Result ─────────────────────────────────────────────────────────────────
printf '\n%b═══════════════════════════════════════════════════════════%b\n' "$GREEN" "$NC"
printf '%b  RESTORE DRILL: PASS%b\n' "$GREEN" "$NC"
printf '%b  integrity: ok | users: %s | briefings: %s%b\n' "$GREEN" "$USER_COUNT" "$BRIEFING_COUNT" "$NC"
printf '%b═══════════════════════════════════════════════════════════%b\n\n' "$GREEN" "$NC"
printf 'Record this result in LAUNCH.md §10 (Restore drill log) with today'\''s date.\n\n'
