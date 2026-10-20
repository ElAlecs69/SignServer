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

Los puertos publicados son:

- SignServer: `18080` (HTTP) y `18443` (HTTPS)
- Validador: `18000`
- Nginx: `9080` (HTTP) y `9443` (HTTPS), sin cambios

Las rutas internas entre contenedores siguen usando los puertos de servicio
originales. El validador se construye localmente desde
`Archivos/services/validate-service` (ya no se clona desde GitHub).

Con `UserModeNetworking` desactivado en esta VM, accede a los puertos publicados
desde Windows usando la IP de la VM Podman en vez de `localhost`; la IP se puede
consultar con `podman machine ssh podman-machine-default ip -4 addr show eth0`.

Los certificados y los datos de las bases se conservan en volúmenes de Podman.

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
2. En `Datos.env` pon la IP o dominio del servidor en `SIGNSERVER_IP`,
   `APP_PUBLIC_URL`, `OIDC_REDIRECT_URI` y `PUBLIC_DOMAIN`.
3. Levanta el stack:

   ```bash
   podman compose --env-file Datos.env up -d --build
   ```

4. Firewall: abre solo `9443/tcp` (y `9080/tcp` para la redirección).
   - Rocky: `sudo firewall-cmd --permanent --add-port=9443/tcp --add-port=9080/tcp && sudo firewall-cmd --reload`
   - Debian (ufw): `sudo ufw allow 9443/tcp && sudo ufw allow 9080/tcp`
5. Arranque tras reiniciar el servidor:
   - Rootful: `sudo systemctl enable --now podman-restart.service`
   - Rootless: `loginctl enable-linger $USER` y
     `systemctl --user enable --now podman-restart.service`

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
