# signserver-web

Frontend interno para firmar documentos a través de SignServer, servido detrás de
nginx (`signserver-web` en tu stack de Podman). Stack: **Vite + React + TypeScript
+ Tailwind CSS**.

## 1. Desarrollo local

Requiere Node.js 20+.

```bash
npm install
npm run dev
```

Esto levanta un servidor de desarrollo con recarga en caliente. El proxy en
`vite.config.ts` reenvia `/signserver/*` al backend de SignServer y
`/validate/*` al servicio de validacion.

## 2. Build de producción

```bash
npm run build
```

Genera la carpeta `dist/` — son los archivos estáticos finales que nginx debe
servir en `/usr/share/nginx/html`.

## 3. Subir el codigo a GitHub

```bash
git init
git add .
git commit -m "Primera versión del frontend de firma"
git branch -M main
git remote add origin https://github.com/<tu-usuario>/signserver-web.git
git push -u origin main
```

Desde aquí, cada cambio que hagas es: editar código → `git commit` →
`git push`. El repo queda como única fuente de verdad — se acabó copiar
archivos sueltos con `podman cp` a mano.

## 4. Sincronizacion automatica al servidor (CI/CD)

Como tu servidor vive en una red privada (`172.18.117.229`, dentro de WSL2),
**GitHub no puede conectarse a él directamente** — por eso el pipeline en
`.github/workflows/main.yml` usa un **runner self-hosted**: un pequeño
agente que instalas tú en la máquina Debian, que escucha al repo y ejecuta el
build/deploy localmente cuando hay un push a `main`.

### Registrar el runner (una sola vez, en la máquina Debian)

1. En GitHub: `Settings` → `Actions` → `Runners` → `New self-hosted runner`.
2. Sigue las instrucciones que te da GitHub para Linux x64 (descargar el
   paquete, `./config.sh --url ... --token ...`).
3. Cuando te pida las **etiquetas (labels)** del runner, agrega `signserver`
   (así coincide con `runs-on: [self-hosted, signserver]` del workflow).
4. Instálalo como servicio para que quede siempre escuchando:
   ```bash
   sudo ./svc.sh install
   sudo ./svc.sh start
   ```

Desde ese momento: cada `git push` a `main` dispara el workflow, que compila
el proyecto y copia `dist/` directo al contenedor `signserver-web`
(`podman cp` + `nginx -s reload`) — sin que tengas que tocar la terminal del
servidor de nuevo.

### Alternativa más simple (sin GitHub Actions)

Si prefieres no montar un runner todavía, puedes lograr algo parecido con un
script + cron/systemd timer en el propio servidor Debian que haga `git pull`
periódicamente:

```bash
#!/bin/bash
cd /home/tu-usuario/signserver-web
git pull --quiet
if [ "$(git rev-parse HEAD)" != "$(cat .last-deployed-commit 2>/dev/null)" ]; then
  npm ci && npm run build
  podman cp dist/. signserver-web:/usr/share/nginx/html
  podman exec signserver-web nginx -s reload
  git rev-parse HEAD > .last-deployed-commit
fi
```

Prográmalo cada 1-2 minutos con `crontab -e`. Es más simple, pero menos
inmediato que el runner (que reacciona al instante del push).

## 5. Ajustar los workers disponibles

La lista de workers que aparecen en el desplegable vive en
`src/App.tsx` (`const WORKERS = [...]`). Ajusta los `id` para que coincidan
exactamente con los nombres de worker activos en tu `signserver.properties`
(verifica con `signserver getstatus brief all` si tienes dudas).

## Estructura del frontend

```
signserver-web/
├── src/
│   ├── App.tsx        # UI principal (dropzone, worker, bitácora, sello)
│   ├── Seal.tsx        # elemento visual de la firma (sello SVG animado)
│   ├── index.css       # estilos base + Tailwind
│   └── main.tsx
└── tailwind.config.js    # tokens de diseño (paleta, tipografía, animaciones)
```
