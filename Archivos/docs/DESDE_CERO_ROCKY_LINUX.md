# SignServer desde cero en Rocky Linux

Instalación limpia, sin datos previos. Requiere `sudo` en la máquina
Rocky Linux.

## Variables de esta instalacion

Desde `Archivos/`, crea `.env` a partir de `.env.example` y completa los
secretos. No los escribas en esta guia ni los subas al repositorio.

```bash
cp .env.example .env
chmod 600 .env
vi .env
```

| Uso | Valor |
|---|---|
| `DATABASE_PASSWORD` | `<secreto>` |
| `MYSQL_ROOT_PASSWORD` | `<secreto>` |
| `KEYSTORE_PASSWORD` | `<secreto>` |

---

## 0. Preparar el sistema

```bash
sudo dnf update -y
sudo dnf install -y podman podman-compose nodejs git
podman --version
```

No se necesita ninguna máquina virtual intermedia (a diferencia de
Windows) -- Podman corre directo sobre el kernel de Rocky Linux.

Obtén la IP real de tu máquina (la vas a necesitar más adelante):
```bash
hostname -I
```

---

## 1. Levantar la infraestructura con `docker-compose.yml`

La descarga de imágenes, la red, los volúmenes, la base de datos,
SignServer, los keystores, el validador y Nginx están consolidados en
`docker-compose.yml`.

1. Copia el directorio del proyecto a tu máquina Rocky Linux y entra en
   `Archivos/`.
2. Crea y completa `.env` usando las instrucciones anteriores. Define
   `SIGNSERVER_IP` con la IP real de Rocky Linux.
   ```bash
   cd ~/signserver/Archivos
   mkdir -p runtime/tls runtime/ca runtime/keystores
   sed -i 's/^SIGNSERVER_IP=.*/SIGNSERVER_IP=<IP_ROCKY>/' .env
   ```
3. Levanta todo:
   ```bash
   podman compose -f docker-compose.yml up -d --build
   ```

Esto descarga las imágenes, crea la red y los volúmenes, genera el
verifica el certificado HTTPS y los 8 keystores reales, instala la
configuración de Nginx y levanta los 5 contenedores --
todo en un solo comando. La configuración de workers y la compilación del
frontend se realizan en los puntos siguientes.

Verifica que corrió bien:
```bash
   podman logs signserver-init-certs   # debe mostrar "Inicialización terminada correctamente"
podman ps                           # los 4 servicios deben estar "Up"
```

Espera a que SignServer termine de iniciar (30-90s) antes de continuar:
```bash
podman logs -f signserver-app
```

---

## 8. Configurar los 8 workers de firma (necesario para firmar)

Compose crea los contenedores y monta los keystores, pero no puede crear
estos workers dentro de la base de datos. Ejecuta los comandos siguientes una
vez que `signserver-app` haya terminado de iniciar:

```bash
SS="podman exec -it signserver-app /opt/keyfactor/signserver/bin/signserver"
KSPW="$(grep '^KEYSTORE_PASSWORD=' .env | cut -d= -f2-)"

# --- Worker 1: PDFSigner ---
$SS setproperty 1 NAME PDFSigner
$SS setproperty 1 IMPLEMENTATION_CLASS org.signserver.module.pdfsigner.PDFSigner
$SS setproperty 1 AUTHTYPE NOAUTH
$SS setproperty 1 KEYSTOREPATH /opt/keyfactor/signserver/res/test/pdfsigner.p12
$SS setproperty 1 KEYSTOREPASSWORD "$KSPW"
$SS setproperty 1 KEYSTORETYPE PKCS12
$SS setproperty 1 DEFAULTKEY pdfsigner
$SS reload 1

# --- Worker 2: TimeStampSigner ---
$SS setproperty 2 NAME TimeStampSigner
$SS setproperty 2 IMPLEMENTATION_CLASS org.signserver.module.tsa.TimeStampSigner
$SS setproperty 2 AUTHTYPE NOAUTH
$SS setproperty 2 KEYSTOREPATH /opt/keyfactor/signserver/res/test/timestamp1.p12
$SS setproperty 2 KEYSTOREPASSWORD "$KSPW"
$SS setproperty 2 KEYSTORETYPE PKCS12
$SS setproperty 2 DEFAULTKEY timestamp1
$SS setproperty 2 DEFAULTTSAPOLICYOID 1.3.6.1.4.1.22408.1.2.3.45
$SS setproperty 2 ACCEPTANYPOLICY true
$SS reload 2

# --- Worker 3: CMSSigner ---
# La clase exacta no quedó capturada de forma explícita en el log
# revisado -- confírmala en tu instancia de referencia con:
#   podman exec -it signserver-app /opt/keyfactor/signserver/bin/signserver getconfig 3
$SS setproperty 3 NAME CMSSigner
$SS setproperty 3 IMPLEMENTATION_CLASS org.signserver.module.cmssigner.CMSSigner
$SS setproperty 3 AUTHTYPE NOAUTH
$SS setproperty 3 KEYSTOREPATH /opt/keyfactor/signserver/res/test/newcodesigner.p12
$SS setproperty 3 KEYSTOREPASSWORD "$KSPW"
$SS setproperty 3 KEYSTORETYPE PKCS12
$SS setproperty 3 DEFAULTKEY newcodesigner
$SS reload 3

# --- Worker 4: JArchiveSigner ---
$SS setproperty 4 NAME JArchiveSigner
$SS setproperty 4 IMPLEMENTATION_CLASS org.signserver.module.jarchive.signer.JArchiveSigner
$SS setproperty 4 AUTHTYPE NOAUTH
$SS setproperty 4 KEYSTOREPATH /opt/keyfactor/signserver/res/test/jarsigner.p12
$SS setproperty 4 KEYSTOREPASSWORD "$KSPW"
$SS setproperty 4 KEYSTORETYPE PKCS12
$SS setproperty 4 DEFAULTKEY jarsigner
$SS reload 4

# --- Worker 5: DebianDpkgSigSigner ---
$SS setproperty 5 NAME DebianDpkgSigSigner
$SS setproperty 5 IMPLEMENTATION_CLASS org.signserver.module.debiandpkgsig.signer.DebianDpkgSigSigner
$SS setproperty 5 AUTHTYPE NOAUTH
$SS setproperty 5 KEYSTOREPATH /opt/keyfactor/signserver/res/test/debsigner.p12
$SS setproperty 5 KEYSTOREPASSWORD "$KSPW"
$SS setproperty 5 KEYSTORETYPE PKCS12
$SS setproperty 5 DEFAULTKEY debsigner
$SS reload 5

# --- Worker 6: XMLSigner ---
$SS setproperty 6 NAME XMLSigner
$SS setproperty 6 IMPLEMENTATION_CLASS org.signserver.module.xmlsigner.XMLSigner
$SS setproperty 6 AUTHTYPE NOAUTH
$SS setproperty 6 KEYSTOREPATH /opt/keyfactor/signserver/res/test/xmlsigner.p12
$SS setproperty 6 KEYSTOREPASSWORD "$KSPW"
$SS setproperty 6 KEYSTORETYPE PKCS12
$SS setproperty 6 DEFAULTKEY xmlsigner
$SS reload 6

# --- Worker 7: MRTDSigner (uso avanzado) ---
# Clase inferida por el patrón consistente con MRTDSODSigner (worker 8,
# sí confirmada) -- verifica contra tu referencia si tienes dudas.
$SS setproperty 7 NAME MRTDSigner
$SS setproperty 7 IMPLEMENTATION_CLASS org.signserver.module.mrtdsigner.MRTDSigner
$SS setproperty 7 AUTHTYPE NOAUTH
$SS setproperty 7 KEYSTOREPATH /opt/keyfactor/signserver/res/test/mrtdsigner.p12
$SS setproperty 7 KEYSTOREPASSWORD "$KSPW"
$SS setproperty 7 KEYSTORETYPE PKCS12
$SS setproperty 7 DEFAULTKEY mrtdsigner
$SS reload 7

# --- Worker 8: MRTDSODSigner (uso avanzado) ---
$SS setproperty 8 NAME MRTDSODSigner
$SS setproperty 8 IMPLEMENTATION_CLASS org.signserver.module.mrtdsodsigner.MRTDSODSigner
$SS setproperty 8 AUTHTYPE NOAUTH
$SS setproperty 8 KEYSTOREPATH /opt/keyfactor/signserver/res/test/mrtdsodsigner.p12
$SS setproperty 8 KEYSTOREPASSWORD "$KSPW"
$SS setproperty 8 KEYSTORETYPE PKCS12
$SS setproperty 8 DEFAULTKEY mrtdsodsigner
$SS reload 8
```

Verifica que los 8 quedaron activos:
```bash
$SS getstatus brief all
```

---

## 9. Compilar y desplegar el frontend

```bash
cd ~/SignServer/Archivos/signserver-web
npm install
npm run build
podman cp dist/. signserver-web:/usr/share/nginx/html
podman exec signserver-web nginx -s reload
```

---

## 10. Ver la página en el navegador

```
https://<IP_ROCKY>/
```
Certificado autofirmado -> el navegador mostrará advertencia. Acepta
la excepción ("Opciones avanzadas" -> "Continuar de todas formas").

Verificación desde terminal, antes de abrir el navegador:
```bash
curl -k https://localhost/
podman exec -it signserver-app /opt/keyfactor/signserver/bin/signserver getstatus brief all
```

---

## 11. (Opcional) ngrok para acceso desde internet

```bash
curl -o ngrok.tgz https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-amd64.tgz
tar xzf ngrok.tgz
sudo mv ngrok /usr/local/bin/

ngrok config add-authtoken <TU_TOKEN>

ngrok http https://localhost \
  --oauth=microsoft \
  --oauth-allow-domain=alumno.uaemex.mx \
  --verify-upstream-tls=false
```

Para que sobreviva a reinicios (en Rocky Linux sí funciona el servicio
systemd normal, sin el problema de políticas de dominio de Windows):
```bash
sudo tee /etc/systemd/system/ngrok-signserver.service > /dev/null << 'EOF'
[Unit]
Description=Tunel ngrok para SignServer
After=network.target

[Service]
ExecStart=/usr/local/bin/ngrok http https://localhost --oauth=microsoft --oauth-allow-domain=alumno.uaemex.mx --verify-upstream-tls=false
Restart=always
User=REEMPLAZA_TU_USUARIO

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now ngrok-signserver
```

---

## Resumen

- 3 contraseñas fuertes generadas para este despliegue (ver tabla al
  inicio).
- Certificado HTTPS de Nginx, cadena de CA y 8 keystores de firma: deben
   ser emitidos por la PKI real y colocarse en `runtime/` antes del punto 1.
