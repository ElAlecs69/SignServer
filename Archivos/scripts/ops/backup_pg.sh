#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

[[ -f .env ]] || { echo "ERROR: falta .env." >&2; exit 1; }
set -a
source .env
set +a

BACKUP_DIR="${BACKUP_DIR:-$ROOT_DIR/backups/postgres}"
RETENTION_DAYS="${RETENTION_DAYS:-30}"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
output="$BACKUP_DIR/signserver_business_${stamp}.dump.gz"

echo "Creando respaldo PostgreSQL: $output"
podman exec signserver-business-db pg_dump \
  --format=custom \
  --no-owner \
  --no-privileges \
  --username="${BUSINESS_DB_USER:-signserver_app}" \
  --dbname="${BUSINESS_DB_NAME:-signserver_business}" \
  | gzip -9 > "$output"
chmod 600 "$output"
find "$BACKUP_DIR" -type f -name 'signserver_business_*.dump.gz' -mtime "+$RETENTION_DAYS" -delete

test -s "$output"
echo "Respaldo completado. Prueba la restauracion con restore_pg_test.sh."
