# Runbook de produccion en Rocky Linux

## 1. Crear el entorno

Desde el directorio del proyecto:

```bash
bash scripts/setup/generate-production-env.sh
```

El script genera secretos con `openssl rand -hex 32`, crea `runtime/` y
escribe `.env` con permisos `600`. Completa despues:

- `OIDC_CLIENT_ID`
- `OIDC_CLIENT_SECRET`
- `OIDC_SERVER_METADATA_URL` con el tenant real
- `ADMIN_EMAILS`
- `AUDITOR_EMAILS`

No subas `.env` al repositorio.

## 2. Material criptografico

Instala los certificados institucionales en las rutas descritas por los
README de `runtime/tls`, `runtime/ca`, `runtime/admin` y `runtime/keystores`.
El servicio `signserver-materials` falla si falta cualquier archivo requerido.

## 3. Levantar la pila

```bash
podman compose -f docker-compose.yml config --quiet
podman compose -f docker-compose.yml up -d --build
podman compose ps
```

Solo Nginx publica puertos 80 y 443. SignServer, PostgreSQL, MariaDB,
ClamAV y document-api permanecen en `signserver-net`.

## 4. Smoke test

```bash
bash scripts/ops/smoke_test.sh
```

El test verifica API, validador, deteccion EICAR de ClamAV y que SignServer
no tenga puertos publicados en el host.

## 5. Backups diarios

Instala el servicio y timer:

```bash
sudo install -m 0755 scripts/ops/backup_pg.sh /opt/signserver/Archivos/scripts/ops/backup_pg.sh
sudo install -m 0644 scripts/ops/signserver-pg-backup.service /etc/systemd/system/
sudo install -m 0644 scripts/ops/signserver-pg-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now signserver-pg-backup.timer
systemctl list-timers signserver-pg-backup.timer
```

El backup se guarda en `backups/postgres/` y conserva por defecto 30 dias.
Usa almacenamiento cifrado o remoto para una estrategia real de recuperacion.

Prueba restauracion:

```bash
bash scripts/ops/restore_pg_test.sh backups/postgres/signserver_business_FECHA.dump.gz
```

La prueba restaura a una base temporal y valida las tablas del esquema.

## 6. Observaciones de produccion

- PostgreSQL y MariaDB deben tener backups independientes.
- Los backups deben copiarse fuera del host y probarse periodicamente.
- El certificado TLS del dominio y los certificados de firma institucional no
  se generan en Compose.
- Entra ID debe usar HTTPS y el redirect URI exacto `/auth/callback`.
- Para Internet publico se recomienda WAF, firewall con solo 80/443 y
  monitorizacion de logs.
