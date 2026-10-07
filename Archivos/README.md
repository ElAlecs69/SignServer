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
podman compose -f "docker compose.yml" --env-file Datos.env up -d --build
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
originales. El `Dockerfile` de la raíz clona el repositorio y construye el
validador desde `Archivos/services/validate-service`.

Con `UserModeNetworking` desactivado en esta VM, accede a los puertos publicados
desde Windows usando la IP de la VM Podman en vez de `localhost`; la IP se puede
consultar con `podman machine ssh podman-machine-default ip -4 addr show eth0`.

Los certificados y los datos de las bases se conservan en volúmenes de Podman.

## Validaciones

```powershell
podman compose -f docker-compose.yml config --quiet
cd signserver-web
npm run build
```