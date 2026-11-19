# SignServer

Proyecto de firma y validacion digital con SignServer CE, un frontend React y
un servicio independiente de validacion de documentos.

## Estructura

```text
Archivos/
|- docker-compose.yml
|- signserver-web/
|- services/validate-service/
|- deploy/nginx/
|- docs/
|- scripts/
|- runtime/
`- .github/workflows/
```

Los secretos se definen localmente en `.env`, creado a partir de
`.env.example`. Los certificados y keystores reales deben instalarse en
`runtime/` antes de arrancar el stack.

## Desarrollo y despliegue

```powershell
cd Archivos\signserver-web
npm install
npm run dev
npm run build
cd ..\..
podman compose --env-file Datos.env up -d --build
```

En esta máquina Podman/WSL, el controlador `pids` no se delega a los
contenedores. Por eso se configuró el límite predeterminado de procesos en
cero en el almacén rootful de la VM. Si se recrea esa VM, hay que aplicar de
nuevo este ajuste antes de iniciar:

```powershell
wsl.exe -d podman-machine-default -u root -- mkdir -p /root/.config/containers
"[containers]`npids_limit=0" | wsl.exe -d podman-machine-default -u root -- tee /root/.config/containers/containers.conf
podman machine ssh podman-machine-default systemctl restart podman.service
```

El servicio `signserver-app` usa `cgroup: host`: la imagen necesita leer
`/sys/fs/cgroup/memory.max` al iniciar, archivo que no aparece en el namespace
cgroup privado de esta VM Podman/WSL.

Los puertos del host se enlazan solo a `127.0.0.1`; el acceso externo se hace
por Ngrok:

- SignServer: `127.0.0.1:18080` y `127.0.0.1:18443`
- Validador: `127.0.0.1:18000`
- Nginx: `127.0.0.1:9080` y `127.0.0.1:9443`

Las rutas internas entre contenedores siguen usando los puertos de servicio
originales. El validador se construye localmente desde
`Archivos/services/validate-service` (ya no se clona desde GitHub).

Con `UserModeNetworking` desactivado en esta VM, accede a los puertos publicados
desde Windows usando la IP de la VM Podman en vez de `localhost`; la IP se puede
consultar con `podman machine ssh podman-machine-default ip -4 addr show eth0`.

Los certificados y los datos de las bases se conservan en volúmenes de Podman.

## Acceso institucional UAEMéx

El acceso público entra por Ngrok. Su OAuth administrado de Microsoft valida
las cuentas `@alumno.uaemex.mx`; no requiere registrar una aplicación Entra ni
guardar credenciales de Microsoft en `Datos.env`. Cerrar sesión elimina las
sesiones locales de la app y Ngrok, pero Microsoft puede conservar la sesión
del navegador y autenticar silenciosamente en la próxima entrada. Para
forzar una nueva captura de credenciales, cierra también la sesión de Microsoft
o usa una ventana privada. Está en
`Archivos/deploy/ngrok-traffic-policy.yml` y el servicio persistente de usuario
en `Archivos/scripts/ops/ngrok-signserver.service`.

Instala el agente en Rocky y registra su authtoken como `thelma` (no uses
`sudo` para este paso):

```bash
sudo dnf install -y curl tar
curl -fsSL https://bin.equinox.io/c/bNyj1mQVY4c/ngrok-v3-stable-linux-amd64.tgz -o /tmp/ngrok.tgz
tar -xzf /tmp/ngrok.tgz -C /tmp
sudo install -m 0755 /tmp/ngrok /usr/local/bin/ngrok
ngrok config add-authtoken <TOKEN_DEL_DASHBOARD_NGROK>
```

Instala y activa la unidad de Ngrok junto al servicio Compose:

```bash
mkdir -p ~/.config/systemd/user
install -m 0644 Archivos/scripts/ops/ngrok-signserver.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now ngrok-signserver.service
systemctl --user status ngrok-signserver.service --no-pager
journalctl --user -u ngrok-signserver.service -n 40 --no-pager
```

Usa la URL `Forwarding` que muestra el registro de Ngrok. Los puertos de la
app están ligados a `127.0.0.1`; no abras `9080`, `9443`, `18000`, `18080` ni
`18443` en el firewall. Así Ngrok, ejecutándose en Rocky, es el único acceso
externo y el correo que pasa al backend no puede falsificarse desde Internet.
Configura `APP_PUBLIC_URL` con la URL Ngrok del sitio para los enlaces que
genere la aplicación.

## Validaciones

```powershell
podman compose --env-file Datos.env config --quiet
cd signserver-web
npm run build
```


## Despliegue en Linux (Debian / Rocky Linux)

Paquetes (Podman con `podman-compose`; en Rocky este último viene de EPEL):

```bash
# Debian
sudo apt install -y podman podman-compose

# Rocky Linux
sudo dnf install -y epel-release
sudo dnf install -y podman podman-compose
```

1. Copia `docker-compose.yml`, `Datos.env` y `Archivos/` (con
   `signserver-web/dist` ya compilado). No copies `certs/`, `keystores_backup/`
   ni volúmenes: se regeneran solos en la máquina nueva.
2. En `Datos.env` pon la IP del servidor en `SIGNSERVER_IP` y la URL Ngrok
  asignada a tu cuenta en `APP_PUBLIC_URL`.
3. Levanta el stack:

   ```bash
   podman compose --env-file Datos.env up -d --build
   ```

4. No abras puertos de la aplicación en el firewall. Compose los publica solo
  en `127.0.0.1`; Ngrok crea el túnel saliente desde Rocky.
5. Habilita el arranque tras reiniciar el servidor con el mismo modo Podman
   que usaste para levantar la pila; no mezcles comandos con y sin `sudo`:
   - Rootful (la pila se levantó con `sudo podman compose`):
     `sudo systemctl enable --now podman-restart.service`
   - Rootless (la pila se levantó con `podman compose`): crea un servicio de
     usuario desde el directorio del proyecto. Esto no depende de que la
     distribución incluya `podman-restart.service`:

     ```bash
     PROJECT_DIR="$(pwd -P)"
     PODMAN_BIN="$(command -v podman)"
     sudo loginctl enable-linger "$USER"
     mkdir -p "$HOME/.config/systemd/user"
     cat > "$HOME/.config/systemd/user/signserver-compose.service" <<EOF
     [Unit]
     Description=SignServer Compose stack
     Wants=network-online.target
     After=network-online.target

     [Service]
     Type=simple
     WorkingDirectory=$PROJECT_DIR
     ExecStart=$PODMAN_BIN compose --env-file $PROJECT_DIR/Datos.env up --build
     ExecStop=$PODMAN_BIN compose --env-file $PROJECT_DIR/Datos.env down
     Restart=always
     RestartSec=10
     TimeoutStartSec=0
     TimeoutStopSec=120

     [Install]
     WantedBy=default.target
     EOF
     systemctl --user daemon-reload
     systemctl --user enable --now signserver-compose.service
     ```

6. Instala y habilita `ngrok-signserver.service` como se describe en **Acceso
   institucional UAEMéx**. La URL pública es la URL Ngrok de tu cuenta; no uses
   la IP directa del servidor.

   El servicio mantiene Compose en primer plano, lo reinicia si termina y
   vuelve a levantar la pila tras un reinicio del host. `init-certs` e
   `init-workers` son tareas de una sola ejecución. Esto no evita una caída
   del host ni sustituye la revisión de salud y los logs.

Notas:

- Los montajes desde carpetas del proyecto llevan `:Z` para SELinux (Rocky); en
  Debian se ignora.
- Si ejecutas con `sudo` (rootful), `./certs` queda como propiedad de root.
- Nginx vuelve a resolver el DNS de los contenedores en cada petición, así que
  ya no hace falta reiniciar `signserver-web` al recrear `document-api` o
  `signserver-validate`.
- Con `ADMINWEB_ACCESS` se usa el certificado `certs/admin-client.p12`; es nuevo
  en cada máquina y hay que importarlo en el navegador.
- Los ajustes `pids_limit` y de IP de la VM son solo de Podman en Windows/WSL.
