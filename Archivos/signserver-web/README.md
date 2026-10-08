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

## 6. Formatos PDF

La carpeta `../../Formatos` contiene las plantillas originales que Vite publica
con el frontend. La vista **Formatos** reconstruye el texto de cada página en
una capa HTML de PDF.js y mantiene los elementos gráficos originales como
fondo para conservar su fidelidad visual. Muestra los campos de captura en el
panel izquierdo y el PDF original en el panel derecho. Los campos HTML no se
superponen al PDF de vista previa; al firmar, sus valores se integran en el
documento original. Ofrece campos para evaluaciones y detecta etiquetas y
líneas de captura en las demás plantillas. `RevisorDeProtocolo.pdf` (ya contiene datos de un caso) y
`RUBRICA EVAL PROTOCOLO.pdf` (matriz de evaluación sin campos de captura) se
muestran solo para consulta. No agrega campos PDF AcroForm. Al firmar, los
valores HTML se dibujan como texto vectorial sobre el PDF original y se añade
la firma manuscrita recortada y alineada con la línea de firma del formato.
La marca del cargo del comité se centra en los paréntesis localizados en el
texto PDF. El documento resultante se envía a `PDFSigner`; se puede descargar
o cargar directamente al flujo de asignaciones. Nginx debe servir los archivos
`.mjs` de PDF.js como `application/javascript` para que el worker cargue desde
el origen HTTPS. La firma directa envía el PDF a `/api/direct/sign` como JSON
con el contenido en Base64; por ello, el Nginx generado en `docker compose.yml`
permite cuerpos de hasta `999M` para evitar respuestas `413 Request Entity Too
Large` con documentos grandes.
Los campos detectados también usan controles según su contenido: las fechas se
seleccionan con un control de calendario y se imprimen como `dd/mm/aaaa` (o
`dd/mm/aa` cuando así lo indica la plantilla), los correos se validan como
direcciones de email y los campos numéricos aplican límites para porcentajes,
semestres, duración y calificaciones antes de firmar.
En la evaluación CONACYT, las fechas se distribuyen en las posiciones
preimpresas de día, mes y año, y cada renglón de «Actividades realizadas» exige
seleccionar una calificación; la opción se marca con una X en su celda original.

### Identificación de tablas con Azure AI

El botón **Identificar tablas con Azure AI** envía el PDF seleccionado desde el
backend a Azure AI Document Intelligence (`prebuilt-layout`). El servicio
detecta la estructura de las tablas y las coordenadas de sus celdas; las celdas
vacías se convierten en controles y las tablas de calificación en opciones que
se marcan en la celda del PDF. El PDF no se envía hasta que el usuario inicia
el análisis. Las celdas detectadas deben revisarse antes de firmar: el servicio
detecta geometría y OCR, pero no certifica por sí solo el significado de cada
campo.

Para habilitarlo, crea un recurso Azure Document Intelligence **F0** y define
`DOCUMENT_INTELLIGENCE_ENDPOINT` y `DOCUMENT_INTELLIGENCE_KEY` en el `.env`
raíz del despliegue. Nunca pongas la clave en el frontend ni en Git. El nivel
F0 limita cada solicitud de análisis a dos páginas; el backend divide el PDF en
bloques de hasta dos páginas. La aplicación requiere reconstruir `document-api`
para instalar la dependencia PDF nueva y propagar las variables al servicio.

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
