#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

if [[ -e .env ]]; then
  echo "ERROR: .env ya existe; no se sobrescribira." >&2
  exit 1
fi

command -v openssl >/dev/null || { echo "ERROR: openssl es obligatorio." >&2; exit 1; }
read -r -p "Dominio publico de la aplicacion: " public_domain
read -r -p "Correo de Let's Encrypt: " letsencrypt_email
read -r -p "IP o nombre interno de SignServer: " signserver_ip

[[ "$public_domain" != *" "* && "$public_domain" == *.* ]] || { echo "ERROR: dominio invalido." >&2; exit 1; }
[[ -n "$letsencrypt_email" && -n "$signserver_ip" ]] || { echo "ERROR: faltan valores." >&2; exit 1; }

secret() { openssl rand -hex 32; }
cat > .env <<EOF
SIGNSERVER_IP=$signserver_ip
PUBLIC_DOMAIN=$public_domain
APP_PUBLIC_URL=https://$public_domain
OIDC_REDIRECT_URI=https://$public_domain/auth/callback
LETSENCRYPT_DOMAIN=$public_domain
LETSENCRYPT_EMAIL=$letsencrypt_email
SECRET_KEY=$(secret)
SESSION_SECRET=$(secret)
BUSINESS_DB_NAME=signserver_business
BUSINESS_DB_USER=signserver_app
BUSINESS_DB_PASSWORD=$(secret)
MYSQL_DATABASE=signserver
MYSQL_USER=signserver
MYSQL_PASSWORD=$(secret)
MYSQL_ROOT_PASSWORD=$(secret)
DATABASE_USER=signserver
DATABASE_PASSWORD=$(secret)
KEYSTORE_PASSWORD=$(secret)
ADMIN_P12_PASSWORD=$(secret)
OIDC_CLIENT_ID=FALTA_CONFIGURAR_EN_MICROSOFT_ENTRA
OIDC_CLIENT_SECRET=FALTA_CONFIGURAR_EN_MICROSOFT_ENTRA
OIDC_SERVER_METADATA_URL=https://login.microsoftonline.com/TENANT_ID/v2.0/.well-known/openid-configuration
ADMIN_EMAILS=admin@example.org
AUDITOR_EMAILS=auditor@example.org
SIGN_SERVER_WORKER=PDFSigner
MAX_UPLOAD_BYTES=26214400
CLAMAV_HOST=clamav
EOF
chmod 600 .env
mkdir -p runtime/tls runtime/ca runtime/admin runtime/keystores backups

echo "Creado .env con secretos aleatorios. Completa las variables OIDC antes de iniciar."
echo "No copies .env al repositorio ni lo compartas por chat."
