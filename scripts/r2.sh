#!/usr/bin/env bash
# rclone against MapNG's R2 bucket, using ~/.config/mapng/r2.env (never
# committed; see refs/output/osm-data-sources.md). Credentials go to rclone via
# environment variables only, so they never land on a command line or in an
# rclone.conf.
#
#   scripts/r2.sh lsf r2:mapng-osm
#   scripts/r2.sh copyto local.pmtiles r2:mapng-osm/osm/name.pmtiles --progress
set -euo pipefail
ENV_FILE="${MAPNG_R2_ENV:-$HOME/.config/mapng/r2.env}"
RCLONE="${RCLONE:-$(command -v rclone || echo "$HOME/.local/bin/rclone")}"
[ -r "$ENV_FILE" ] || { echo "missing $ENV_FILE" >&2; exit 1; }
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
export RCLONE_CONFIG_R2_TYPE=s3
export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
export RCLONE_CONFIG_R2_ENDPOINT="$R2_ENDPOINT"
export RCLONE_CONFIG_R2_NO_CHECK_BUCKET=true   # token is scoped to one bucket
export RCLONE_CONFIG=/dev/null                  # no rclone.conf; everything is above
export RCLONE_LOG_LEVEL="${RCLONE_LOG_LEVEL:-ERROR}"
exec "$RCLONE" "$@"
