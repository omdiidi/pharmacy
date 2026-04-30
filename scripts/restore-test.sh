#!/usr/bin/env bash
# Monthly restore-test: pull latest backup from B2, decrypt, restore into a
# throwaway Supabase project, assert seed data is present.
# Run via Render Cron Job using Dockerfile.backup. See render.yaml.
#
# Required env:
#   BACKUP_PASSPHRASE     gpg symmetric passphrase
#   B2_KEY_ID             Backblaze application key id
#   B2_APPLICATION_KEY    Backblaze application key secret
#   B2_BUCKET             Backblaze bucket name
#   B2_ENDPOINT_URL       e.g. https://s3.us-west-004.backblazeb2.com
#   RESTORE_TEST_DB_URL   Postgres URI of a throwaway Supabase project

set -euo pipefail

: "${BACKUP_PASSPHRASE:?BACKUP_PASSPHRASE is required}"
: "${B2_KEY_ID:?B2_KEY_ID is required}"
: "${B2_APPLICATION_KEY:?B2_APPLICATION_KEY is required}"
: "${B2_BUCKET:?B2_BUCKET is required}"
: "${B2_ENDPOINT_URL:?B2_ENDPOINT_URL is required}"
: "${RESTORE_TEST_DB_URL:?RESTORE_TEST_DB_URL is required}"

export AWS_ACCESS_KEY_ID="$B2_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$B2_APPLICATION_KEY"
export AWS_DEFAULT_REGION="us-west-004"

# --- find latest backup ------------------------------------------------------
echo "[restore-test] listing s3://${B2_BUCKET}/"
LATEST=$(aws s3 ls "s3://${B2_BUCKET}/" --endpoint-url "$B2_ENDPOINT_URL" \
  | sort -k1,2 \
  | tail -1 \
  | awk '{print $4}')

if [ -z "${LATEST:-}" ]; then
  echo "[restore-test] FAIL: no backups found in bucket" >&2
  exit 1
fi
echo "[restore-test] latest: ${LATEST}"

# --- download + decrypt + decompress -----------------------------------------
aws s3 cp "s3://${B2_BUCKET}/${LATEST}" /tmp/restore.sql.gz.gpg \
  --endpoint-url "$B2_ENDPOINT_URL"

gpg --decrypt --batch --passphrase-env BACKUP_PASSPHRASE \
  /tmp/restore.sql.gz.gpg 2>/dev/null \
  | gunzip > /tmp/restore.sql

# --- restore into the throwaway project --------------------------------------
echo "[restore-test] applying dump to RESTORE_TEST_DB_URL"
psql "$RESTORE_TEST_DB_URL" -f /tmp/restore.sql >/dev/null

# --- sanity check: at least the seeded pharmacy survived ---------------------
psql "$RESTORE_TEST_DB_URL" -tAc "select count(*) from pharmacies" \
  | tr -d '[:space:]' > /tmp/count

COUNT=$(cat /tmp/count)
if [ "$COUNT" -lt 1 ]; then
  echo "[restore-test] FAIL: pharmacies row count = ${COUNT}" >&2
  exit 1
fi

echo "[restore-test] OK pharmacies=${COUNT} from ${LATEST}"

# --- cleanup -----------------------------------------------------------------
rm -f /tmp/restore.sql /tmp/restore.sql.gz.gpg /tmp/count
