#!/bin/sh
# EDG3 startup script — optionally wraps the app with Litestream continuous replication.
#
# When LITESTREAM_S3_BUCKET is set:
#   1. Download the Litestream binary (cached at /tmp/litestream between restarts).
#   2. If the DB file is missing (fresh volume, new instance), attempt to restore
#      from S3 before the app boots.
#   3. Start Litestream as a wrapper: it replicates WAL frames in real time and
#      forwards signals to the Next.js process for graceful shutdown.
#
# When LITESTREAM_S3_BUCKET is NOT set (local dev, Railway without S3 configured):
#   Falls back to plain `npm start` — no replication, no overhead.
#
# Required env vars when using replication (set on Railway):
#   LITESTREAM_S3_BUCKET, LITESTREAM_S3_ACCESS_KEY_ID, LITESTREAM_S3_SECRET_ACCESS_KEY
#
# See litestream.yml for the full config + restore drill instructions.

set -e

LITESTREAM_VERSION="0.3.13"
LITESTREAM_BIN="/tmp/litestream"
LITESTREAM_CONFIG="/app/litestream.yml"
DB="${DB_PATH:-/data/edg3.db}"

if [ -n "$LITESTREAM_S3_BUCKET" ]; then
  echo "[start] LITESTREAM_S3_BUCKET is set — enabling off-box replication."

  # ── Download Litestream binary ────────────────────────────────────────────
  if [ ! -f "$LITESTREAM_BIN" ]; then
    echo "[start] Downloading Litestream v${LITESTREAM_VERSION}..."
    ARCH="$(uname -m)"
    case "$ARCH" in
      x86_64)  LITESTREAM_ARCH="amd64" ;;
      aarch64) LITESTREAM_ARCH="arm64" ;;
      *)       LITESTREAM_ARCH="amd64" ;;
    esac
    TARBALL="/tmp/litestream.tar.gz"
    URL="https://github.com/benbjohnson/litestream/releases/download/v${LITESTREAM_VERSION}/litestream-v${LITESTREAM_VERSION}-linux-${LITESTREAM_ARCH}.tar.gz"
    if wget -q -O "$TARBALL" "$URL" 2>/dev/null || curl -fsSL -o "$TARBALL" "$URL" 2>/dev/null; then
      tar -C /tmp -xzf "$TARBALL" && rm -f "$TARBALL" && chmod +x "$LITESTREAM_BIN"
      echo "[start] Litestream downloaded OK."
    else
      echo "[start] WARNING: could not download Litestream — falling back to plain start."
      exec npm start
    fi
  fi

  # ── Restore from S3 on a fresh volume ────────────────────────────────────
  if [ ! -f "$DB" ]; then
    echo "[start] DB not found at $DB — attempting restore from S3..."
    mkdir -p "$(dirname "$DB")"
    if "$LITESTREAM_BIN" restore -config "$LITESTREAM_CONFIG" -if-replica-exists "$DB"; then
      echo "[start] Restore from S3 succeeded. App will start with restored data."
    else
      echo "[start] No S3 replica found (first deploy or bucket empty). Starting fresh."
    fi
  fi

  # ── Start Litestream wrapping the app ────────────────────────────────────
  echo "[start] Starting Litestream replication + Next.js..."
  exec "$LITESTREAM_BIN" replicate -config "$LITESTREAM_CONFIG" -exec "npm start"

else
  echo "[start] LITESTREAM_S3_BUCKET not set — starting without off-box replication."
  exec npm start
fi
