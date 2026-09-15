#!/usr/bin/env bash
set -Eeuo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

podman exec signserver-document-api python -c 'import urllib.request; print(urllib.request.urlopen("http://127.0.0.1:8001/health").read().decode())'
podman exec signserver-validate wget -qO- http://127.0.0.1:8000/health
printf '\n'
podman exec signserver-document-api python - <<'PY'
import clamd
scanner = clamd.ClamdNetworkSocket(host="clamav", port=3310, timeout=15)
result = scanner.instream(b"X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*")
print(result)
assert result["stream"][0] == "FOUND", result
PY

if podman port signserver-app 8080 2>/dev/null | grep -q .; then
  echo "ERROR: SignServer 8080 esta publicado en el host." >&2
  exit 1
fi
if podman port signserver-app 8443 2>/dev/null | grep -q .; then
  echo "ERROR: SignServer 8443 esta publicado en el host." >&2
  exit 1
fi

echo "Smoke test correcto: API, validador, ClamAV y aislamiento basico verificados."
