#!/usr/bin/env bash
# Weekly encrypted Supabase backup → Backblaze B2.
# Run via Render Cron Job using Dockerfile.backup. See render.yaml.
#
# Required env:
#   SUPABASE_DB_URL      Postgres connection string (full URI form)
#   BACKUP_PASSPHRASE    gpg symmetric passphrase
#   B2_KEY_ID            Backblaze application key id
#   B2_APPLICATION_KEY   Backblaze application key secret
#   B2_BUCKET            Backblaze bucket name
#   B2_ENDPOINT_URL      e.g. https://s3.us-west-004.backblazeb2.com

set -euo pipefail

: "${SUPABASE_DB_URL:?SUPABASE_DB_URL is required}"
: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is required}"
: "${B2_KEY_ID:?B2_KEY_ID is required}"
: "${B2_APPLICATION_KEY:?B2_APPLICATION_KEY is required}"
: "${B2_BUCKET:?B2_BUCKET is required}"
: "${B2_ENDPOINT_URL:?B2_ENDPOINT_URL is required}"

TS=$(date -u +%Y%m%dT%H%M%SZ)
OUT="/tmp/pharm1-${TS}.sql.gz.gpg"

echo "[backup] starting pg_dump → gzip → gpg → ${OUT}"
pg_dump "${SUPABASE_DB_URL}" \
  --no-owner \
  --no-privileges \
  --quote-all-identifiers \
  | gzip -9 \
  | gpg --symmetric \
        --cipher-algo AES256 \
        --batch \
        --passphrase-env BACKUP_PASSPHRASE \
        --output "${OUT}"

# --- size sanity checks ------------------------------------------------------
SIZE=$(stat -c %s "$OUT" 2>/dev/null || stat -f %z "$OUT")
echo "[backup] encrypted size: ${SIZE} bytes"

if [ "$SIZE" -lt 100000 ]; then
  echo "[backup] FAIL: encrypted output < 100KB — pg_dump probably broke" >&2
  exit 1
fi

# Compare against last week's size from backup_log. Skip ratio check on first run.
LAST_SIZE=$(psql "$SUPABASE_DB_URL" -tAc \
  "select size_bytes from backup_log order by created_at desc limit 1" \
  2>/dev/null | tr -d '[:space:]' || true)

if [ -n "${LAST_SIZE:-}" ]; then
  HALF=$(( LAST_SIZE / 2 ))
  if [ "$SIZE" -lt "$HALF" ]; then
    echo "[backup] FAIL: size ${SIZE} < half of last (${LAST_SIZE}) — silent dump regression" >&2
    exit 1
  fi
fi

# --- sha256 (linux: sha256sum, macOS: shasum -a 256) -------------------------
if command -v sha256sum >/dev/null 2>&1; then
  SHA=$(sha256sum "$OUT" | awk '{print $1}')
else
  SHA=$(shasum -a 256 "$OUT" | awk '{print $1}')
fi
echo "[backup] sha256: ${SHA}"

# --- upload to B2 via aws-cli s3 (S3-compatible API) -------------------------
export AWS_ACCESS_KEY_ID="$B2_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$B2_APPLICATION_KEY"
export AWS_DEFAULT_REGION="us-west-004"

FNAME=$(basename "$OUT")
echo "[backup] uploading to s3://${B2_BUCKET}/${FNAME}"
aws s3 cp "$OUT" "s3://${B2_BUCKET}/${FNAME}" --endpoint-url "$B2_ENDPOINT_URL"

# --- log to backup_log -------------------------------------------------------
psql "$SUPABASE_DB_URL" -c \
  "insert into backup_log (filename, sha256, size_bytes) values ('${FNAME}', '${SHA}', ${SIZE})"

echo "[backup] OK ts=${TS} size=${SIZE} sha=${SHA}"

# --- cleanup -----------------------------------------------------------------
rm -f "$OUT"
