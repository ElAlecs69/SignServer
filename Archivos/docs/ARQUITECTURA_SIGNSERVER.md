# Sistema de Firma Digital — SignServer + Frontend Web

Documento de referencia técnica: arquitectura, cómo se construyó y cómo se
recrearía desde cero. Todo corre sobre **una sola máquina Windows** con
Podman Desktop (vía WSL2) — no hay servidores separados.

---

## 1. Arquitectura general

```
Internet (opcional, vía túnel)
        │
        │  https://xxxx.ngrok-free.dev   (certificado real, login Microsoft)
        ▼
   ┌─────────────────────────┐
   │   ngrok (túnel)          │  --oauth=microsoft --oauth-allow-domain=alumno.uaemex.mx
   └───────────┬─────────────┘
               │  reenvía a
               ▼
Navegador (red local) ──▶ https://172.18.117.229  (IP interna de WSL2, cert autofirmado)
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │  Contenedor: signserver-web     │  nginx:stable
                    │  - sirve el frontend (React)     │
                    │  - proxy_pass /signserver/* ──┐  │
                    └────────────────────────────────┼──┘
                                                      ▼
                    ┌───────────────────────────────────┐
                    │  Contenedor: signserver-app          │  keyfactor/signserver-ce:7.3.2
                    │  - WildFly (appserver embebido)       │
                    │  - SignServer CE 7.3.2 (9 workers)     │
                    └───────────────────┬────────────────────┘
                                        │  JDBC
                                        ▼
                    ┌───────────────────────────────────┐
                    │  Contenedor: signserver-db            │  mariadb:10.11
                    └────────────────────────────────────┘

Todo dentro de la red interna de Podman: signserver-net
Host físico: Windows + Podman Desktop (podman-machine-default, vía WSL2)
```

**No hay Dockerfiles propios** para los tres contenedores originales — usan
**imágenes oficiales sin modificar**, descargadas de Docker Hub. La única
excepción es `signserver-validate` (ver sección 5.1), que sí tiene su
propio `Dockerfile` porque necesita herramientas de verificación que no
vienen en ninguna imagen base.

| Contenedor | Imagen | Rol |
|---|---|---|
| `signserver-db` | `docker.io/library/mariadb:10.11` | Base de datos |
| `signserver-app` | `docker.io/keyfactor/signserver-ce:7.3.2` | SignServer (incluye WildFly internamente) |
| `signserver-web` | `docker.io/library/nginx:stable` | Reverse proxy + frontend estático |
| `signserver-validate` | build propio (`services/validate-service/Dockerfile`) | Verifica firmas con `pdfsig`/`jarsigner`/`openssl`/`gpg`/`xmlsec1` |

Sobre WildFly: **no lo instalamos ni configuramos nosotros** — viene
empaquetado dentro de la imagen `signserver-ce` como su servidor de
aplicaciones Java (`APPSRV_HOME=/opt/keyfactor/appserver`,
`JAVA_HOME=/usr/lib/jvm/java-17-slim`). Solo lo parametrizamos vía
variables de entorno al levantar el contenedor (ver sección 3).

---

## 2. Red y volúmenes

```bash
podman network create signserver-net
```

| Volumen | Contenedor que lo usa | Ruta dentro del contenedor | Contenido |
|---|---|---|---|
| `signserver_db_data` | signserver-db | `/var/lib/mysql` | Datos de MariaDB |
| `signserver_keystores` | signserver-app | `/opt/keyfactor/signserver/res/test` | Llaves criptográficas / keystores |
| *(volumen con nombre hash)* | signserver-app | `/mnt/persistent` | Datos persistentes adicionales de SignServer (contenido exacto no documentado — revisar antes de descartarlo) |
| `nginx_conf` | signserver-web | `/etc/nginx/conf.d` | Configuración de nginx |
| `nginx_html` | signserver-web | `/usr/share/nginx/html` | Build del frontend (se sobreescribe en cada despliegue) |

Ver todos los volúmenes existentes:
```bash
podman volume ls
podman volume inspect <nombre> --format '{{.Mountpoint}}'
```

---

## 3. Backend: MariaDB

```bash
podman run -d --name signserver-db --network signserver-net \
  -e MYSQL_DATABASE=signserver \
  -e MYSQL_USER=signserver \
  -e MYSQL_PASSWORD=signserverpassword \
  -e MYSQL_ROOT_PASSWORD=rootpassword \
  -v signserver_db_data:/var/lib/mysql \
  docker.io/library/mariadb:10.11
```

⚠️ **Nota de seguridad:** estas credenciales están en texto plano en el
comando. Para un entorno real, deberían moverse a `podman secret` o a un
archivo `.env` fuera del control de versiones — actualmente no lo están.

---

## 4. Backend: SignServer (WildFly embebido)

```bash
podman run -d --name signserver-app --network signserver-net \
  -p 8080:8080 -p 8443:8443 \
  -e DATABASE_JDBC_URL="jdbc:mariadb://signserver-db:3306/signserver?characterEncoding=UTF-8" \
  -e DATABASE_USER=signserver \
  -e DATABASE_PASSWORD=signserverpassword \
  -e ALLOW_ANY=false \
  -e APPSERVER_USE_MANAGED_ID=false \
  -e APPSERVER_DEPLOYMENT_TIMEOUT=300 \
  -e LOG_AUDIT_TO_DB=true \
  -e LOG_LEVEL_APP=INFO \
  -e LOG_LEVEL_SERVER=INFO \
  -e LOG_LEVEL_SERVER_SUBSYSTEMS=WARN \
  -e LOG_STORAGE_MAX_SIZE_MB=256 \
  -e OBSERVABLE_BIND=127.0.0.1 \
  -e SMTP_USERNAME=mail-client \
  -e SMTP_PASSWORD=gotmail \
  -e SMTP_DESTINATION=localhost \
  -e SMTP_DESTINATION_PORT=25 \
  -e SMTP_SSL_ENABLED=true \
  -e SMTP_TLS_ENABLED=true \
  -e ADMINWEB_ACCESS=true \
  -e TLS_SETUP_ENABLED=true \
  -e RUN_TIMEMONITOR=false \
  -e METRICS_ENABLED=false \
  -v signserver_keystores:/opt/keyfactor/signserver/res/test \
  -v <volumen_hash>:/mnt/persistent \
  docker.io/keyfactor/signserver-ce:7.3.2
```

Debe arrancar **después** de que MariaDB esté lista (espera a que
`podman logs -f signserver-db` muestre que acepta conexiones).

### 4.1 Workers configurados (9 en total)

Confirmado con `signserver getstatus brief all` — no adivinar ni asumir,
volver a correr este comando si hay dudas:

```bash
podman exec -it signserver-app /opt/keyfactor/signserver/bin/signserver getstatus brief all
```

| ID | Nombre | Tipo | Notas |
|---|---|---|---|
| 1 | `PDFSigner` | Signer | Firma PDF con sello de tiempo |
| 2 | `TimeStampSigner` | Signer | Sellos de tiempo RFC 3161 |
| 3 | `CMSSigner` | Signer | Firma CMS/PKCS#7 |
| 4 | `JArchiveSigner` | Signer | Firma archivos JAR |
| 5 | `DebianDpkgSigSigner` | Signer | Firma paquetes .deb |
| 6 | `XMLSigner` | Signer | Firma XML (XAdES) |
| 7 | `MRTDSigner` | Signer | Documentos de viaje (uso avanzado) |
| 8 | `MRTDSODSigner` | Signer | Document Security Object de MRTD |
| 9 | `CRLValidator` | **Validation Service** | ⚠️ **No soporta el endpoint REST `/process`** — confirmado con error real: `"The process request sent to validation service with ID 9 isn't supported"`. No se puede invocar desde el mismo flujo de firma del frontend. |

Reactivar crypto tokens tras un reinicio/migración (ajustar IDs y PIN
según lo que realmente esté configurado — **no asumir un PIN sin
confirmarlo primero con el administrador del sistema**):
```bash
podman exec -it signserver-app /opt/keyfactor/signserver/bin/signserver activatecryptotoken <ID> <PIN>
```

---

## 5. nginx: reverse proxy + certificados HTTPS

Configuración real en producción (también versionada en el repo, ver
sección 6):

```nginx
server {
    listen 80;
    server_name _;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name _;

    ssl_certificate     /etc/nginx/certs/signserver-web.crt;
    ssl_certificate_key /etc/nginx/certs/signserver-web.key;
    ssl_protocols TLSv1.2 TLSv1.3;

    client_max_body_size 260M;  # debe ser >= max-post-size de WildFly (200 MB) + overhead de Base64

    location / {
        root /usr/share/nginx/html;
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    location /signserver/ {
        proxy_pass http://signserver-app:8080/signserver/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 30s;
        proxy_send_timeout 300s;
        proxy_read_timeout 300s;
        proxy_request_buffering off;
    }

    # Proxy hacia el servicio de validación (pdfsig / jarsigner / openssl / dpkg-sig / xmlsec1)
    location /validate/ {
        proxy_pass http://signserver-validate:8000/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_connect_timeout 30s;
        proxy_send_timeout 120s;
        proxy_read_timeout 120s;
        proxy_request_buffering off;
    }
}
```

### 5.1 Dónde viven los certificados

Los certificados (`signserver-web.crt`, `signserver-web.key`) son
**autofirmados** y están copiados dentro del contenedor en
`/etc/nginx/certs/`. La copia de origen vive en el host, en
`D:\Descargas\SignServer\Archivos\certs\`.

⚠️ **Pendiente/riesgo:** esta ruta dentro del contenedor **no está
respaldada por un volumen con nombre** en la configuración documentada
hasta ahora — si el contenedor `signserver-web` se borra y se recrea
desde cero, los certificados se pierden y hay que volver a copiarlos
manualmente:
```bash
podman cp D:\Descargas\SignServer\Archivos\certs\signserver-web.crt signserver-web:/etc/nginx/certs/signserver-web.crt
podman cp D:\Descargas\SignServer\Archivos\certs\signserver-web.key signserver-web:/etc/nginx/certs/signserver-web.key
```
Se recomienda crear un volumen dedicado (`nginx_certs`) para persistirlos
igual que los demás datos críticos.

### 5.2 Por qué el candado sale "No seguro" en la IP directa

Ninguna autoridad certificadora pública emite certificados para
direcciones IP privadas (`172.18.117.229`) — es una limitación del propio
sistema de TLS, no de esta configuración. El certificado real y confiable
solo existe en la URL pública de **ngrok** (sección 8), que sí es un
dominio válido.

### 5.3 Servicio de validación (`signserver-validate`)

Contenedor nuevo, con `Dockerfile` propio (`services/validate-service/`), en la
misma red `signserver-net`. Expone en el puerto 8000 un backend FastAPI
que **verifica** (no firma) documentos usando herramientas estándar del
sistema, independientes de SignServer:

| Formato | Herramienta | Endpoint |
|---|---|---|
| PDF | `pdfsig` (poppler-utils) | `POST /validate/pdf` |
| JAR | `jarsigner -verify` (JDK) | `POST /validate/jar` |
| CMS (.p7s) | `openssl cms -verify` | `POST /validate/cms` |
| Debian (.deb) | `dpkg-sig --verify` (fallback `gpg --verify`) | `POST /validate/deb` |
| XML | `xmlsec1 --verify` | `POST /validate/xml` |

Body igual que el de firma: `{ "data": "<base64>", "filename": "..." }`.

⚠️ **Nota de confianza:** tal como está, cada validador comprueba la
**integridad** de la firma (que el archivo no se alteró), no la cadena
de certificación completa contra la CA de este SignServer. Cada función
en `main.py` tiene un comentario `TODO-CONFIANZA` marcando dónde apuntar
al certificado/CA real para exigir también la cadena de confianza.

Build y despliegue (mismo patrón que los demás contenedores, sección 6.2):
```bash
podman build -t signserver-validate ./services/validate-service
podman run -d --name signserver-validate --network signserver-net signserver-validate
```

No necesita puerto publicado al host (`-p`) porque nginx lo alcanza por
nombre de contenedor dentro de `signserver-net`, igual que hace con
`signserver-app`.

---

## 6. Frontend: `signserver-web` (repo de código)

- **Repo:** `https://github.com/ElAlecs69/SignServer`
- **Ruta del proyecto dentro del repo:** `signserver-web/` (subcarpeta,
  no la raíz — importante para el workflow de CI/CD, ver sección 7)
- **Stack:** Vite + React + TypeScript + Tailwind CSS
- **Clon local de trabajo:** `D:\Descargas\SignServer\Archivos`

Estructura relevante:
```
signserver-web/
├── src/
│   ├── App.tsx        # UI: dropzone, selector de worker, bitácora, sello animado
│   ├── Seal.tsx        # elemento visual (sello SVG animado)
│   └── index.css
├── deploy/
│   └── signserver.conf # config de nginx de referencia (debe coincidir con la real del contenedor)
└── package.json
```

Lista de workers mostrados en el selector: se define a mano en
`src/App.tsx` (constante `WORKERS`) — **no se lee dinámicamente del
servidor**. Si se agrega/quita un worker en SignServer, hay que editar
ese arreglo manualmente y confirmar el `id` exacto contra
`getstatus brief all`.

Llamada de firma (API REST de SignServer):
```
POST /signserver/rest/v1/workers/<NOMBRE_WORKER>/process
Content-Type: application/json
Body: { "data": "<base64 del archivo>", "encoding": "BASE64" }
```
El campo `encoding: "BASE64"` es obligatorio — sin él, SignServer trata
el string como texto plano y falla con
`"PDF header signature not found"` (bug ya corregido en el código).

### 6.1 Desarrollo local
```bash
cd signserver-web
npm install
npm run dev      # proxy configurado en vite.config.ts hacia la IP real
npm run build    # genera dist/
```

### 6.2 Despliegue manual (sin CI/CD)
```powershell
npm run build
podman exec signserver-web sh -c "rm -rf /usr/share/nginx/html/assets/*"
podman cp dist/. signserver-web:/usr/share/nginx/html
podman exec signserver-web nginx -s reload
```

---

## 7. CI/CD: GitHub Actions + runner self-hosted

**Objetivo:** cada `push` a `main` compila y despliega solo, sin
intervención manual.

### 7.1 Workflow (`.github/workflows/main.yml`)
```yaml
name: Build y desplegar signserver-web

on:
  push:
    branches: [main]
    paths:
      - 'signserver-web/**'

jobs:
  deploy:
    runs-on: [self-hosted, signserver]
    defaults:
      run:
        working-directory: signserver-web

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Instalar Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'
          cache-dependency-path: signserver-web/package-lock.json

      - name: Instalar dependencias
        run: npm install

      - name: Compilar (build de producción)
        run: npm run build

      - name: Publicar en el volumen de nginx
        run: |
          podman exec signserver-web sh -c "rm -rf /usr/share/nginx/html/assets/*"
          podman cp dist/. signserver-web:/usr/share/nginx/html
          podman exec signserver-web nginx -s reload
```

### 7.2 Runner self-hosted — instalación

```powershell
cd D:\
mkdir actions-runner
cd actions-runner
# Descargar el paquete indicado por GitHub (Settings > Actions > Runners > New self-hosted runner)
Invoke-WebRequest -Uri <URL_DEL_ZIP> -OutFile actions-runner-win-x64.zip
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::ExtractToDirectory("$PWD\actions-runner-win-x64.zip", "$PWD")

./config.cmd --url https://github.com/ElAlecs69/SignServer --token <TOKEN>
# Labels adicionales: signserver   (debe coincidir con runs-on del workflow)
```

### 7.3 ⚠️ Detalle crítico: NO usar el servicio de Windows tradicional

`./svc.cmd install` instala el runner corriendo como
`NT AUTHORITY\NETWORK SERVICE` — esa cuenta **no tiene acceso al Podman
del usuario** (Podman Desktop vive en el perfil del usuario que lo
instaló), así que cualquier paso `podman cp`/`podman exec` del workflow
falla con `CommandNotFoundException`.

Además, en este caso las **políticas de dominio** (`alumno\aestradam014`)
bloquean el privilegio "Iniciar sesión como servicio", así que ni
siquiera se puede configurar el servicio con el usuario real.

**Solución adoptada: Tarea Programada de Windows, no un servicio.**

1. `taskschd.msc` → Crear tarea
2. General: **"Ejecutar solo cuando el usuario haya iniciado sesión"**
3. Desencadenador: "Al iniciar sesión" (usuario específico)
4. Acción: Programa `D:\actions-runner\run.cmd`
5. Condiciones: desmarcar restricciones de batería/CA si aplica

Esto hace que el runner corra con los mismos permisos que la sesión de
usuario normal (mismo acceso a Podman que si lo ejecutaras tú a mano).

Probar manualmente sin esperar a un login:
```powershell
Start-ScheduledTask -TaskName "GitHub Actions Runner - SignServer"
Get-Process Runner.Listener -ErrorAction SilentlyContinue
```

---

## 8. Exposición pública: ngrok con autenticación Microsoft

**Objetivo:** dar acceso desde fuera de la red local, restringido solo a
correos institucionales (`@alumno.uaemex.mx`), sin exponer las llaves de
firma a cualquier desconocido.

### 8.1 Instalación

Descargar **ngrok v3** (no v2) desde `https://ngrok.com/download` — el
`.zip` a veces es marcado como falso positivo por Windows Defender/Edge
SmartScreen; es un problema conocido y documentado del propio ngrok
(la técnica de crear túneles salientes se parece heurísticamente al
comportamiento de malware de acceso remoto). Verificar en VirusTotal
antes de confiar si hay dudas.

```powershell
cd D:\ngrok
.\ngrok.exe config add-authtoken <TOKEN_DEL_DASHBOARD>
```

### 8.2 Levantar el túnel con restricción de dominio

UAEMEX usa **Microsoft 365 / Azure AD**, no Google Workspace — por eso
se usa `--oauth=microsoft`, no `--oauth=google`.

```powershell
.\ngrok.exe http https://172.18.117.229 `
  --oauth=microsoft `
  --oauth-allow-domain=alumno.uaemex.mx `
  --verify-upstream-tls=false
```

- `--verify-upstream-tls=false` es necesario porque el certificado de
  nginx (destino del túnel) es autofirmado.
- `--oauth-allow-domain` fue probado explícitamente con una cuenta
  Microsoft externa (fuera del dominio) — el resultado observado es un
  bucle silencioso de login en vez de un mensaje de error explícito,
  pero el efecto neto confirmado es que **la cuenta externa nunca llega
  a ver la página**.

### 8.3 Limitaciones conocidas (plan gratuito)

- La URL pública (`https://xxxx.ngrok-free.dev`) **cambia cada vez que
  se reinicia el túnel** — no hay dominio fijo sin plan de pago o
  dominio propio.
- El túnel depende de que la ventana/proceso de `ngrok.exe` siga
  corriendo — para persistencia entre reinicios, se puede aplicar el
  mismo patrón de Tarea Programada usado para el runner (sección 7.3).

---

## 9. Backup y migración de volúmenes

Para mover datos entre máquinas (o respaldar):
```bash
podman volume export <nombre_volumen> -o <nombre_volumen>.tar
# ... transferir el .tar a destino ...
podman volume create <nombre_volumen>
podman volume import <nombre_volumen> <nombre_volumen>.tar
```
Exportar todos de una vez:
```powershell
$volumes = podman volume ls --format '{{.Name}}'
foreach ($v in $volumes) { podman volume export $v -o "$v.tar" }
```

**Nota:** `podman save` (imágenes) y `podman export` (contenedores) **no
incluyen volúmenes** — son mecanismos independientes. Ver esta sección
para volúmenes específicamente.

---

## 10. Pendientes / riesgos conocidos

- [ ] Credenciales de MariaDB y SMTP están en texto plano en los
      comandos `podman run` — mover a `podman secret` o `.env` fuera de
      git.
- [ ] Certificados HTTPS de nginx no están en un volumen con nombre —
      se pierden si se recrea el contenedor `signserver-web`.
- [ ] `CRLValidator` (worker 9) no es utilizable desde la API REST de
      firma — requeriría la consola de administración o el CLI de
      SignServer si se necesita usarlo.
- [ ] La URL de ngrok es efímera — cambia en cada reinicio del túnel.
- [ ] El volumen con nombre hash montado en `/mnt/persistent` no tiene
      su propósito documentado con certeza — confirmar con el
      administrador original antes de eliminarlo.
