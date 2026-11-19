#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"
[[ -f .env ]] || { echo "ERROR: falta .env." >&2; exit 1; }
set -a
source .env
set +a

backup="${1:-}"
[[ -n "$backup" && -f "$backup" ]] || { echo "Uso: $0 backups/postgres/archivo.dump.gz" >&2; exit 1; }

test_db="${BUSINESS_DB_NAME:-signserver_business}_restore_test"
podman exec signserver-business-db dropdb --if-exists --username="${BUSINESS_DB_USER:-signserver_app}" "$test_db"
podman exec signserver-business-db createdb --username="${BUSINESS_DB_USER:-signserver_app}" "$test_db"

gzip -dc "$backup" | podman exec -i signserver-business-db pg_restore \
  --exit-on-error \
  --no-owner \
  --no-privileges \
  --username="${BUSINESS_DB_USER:-signserver_app}" \
  --dbname="$test_db"

count="$(podman exec signserver-business-db psql -At \
  --username="${BUSINESS_DB_USER:-signserver_app}" \
  --dbname="$test_db" \
  -c "select count(*) from information_schema.tables where table_schema='public';")"
[[ "$count" -ge 4 ]] || { echo "ERROR: restauracion incompleta ($count tablas)." >&2; exit 1; }
echo "Restauracion de prueba correcta: $count tablas."
