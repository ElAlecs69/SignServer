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
cd signserver-web
npm install
npm run dev
npm run build
cd ..
podman compose -f docker-compose.yml up -d --build
```

El Compose no genera certificados ni claves. Requiere estos archivos reales:

```text
runtime/tls/server.crt
runtime/tls/server.key
runtime/ca/trust-chain.pem
runtime/keystores/{pdfsigner,timestamp1,newcodesigner,jarsigner,debsigner,xmlsigner,mrtdsigner,mrtdsodsigner}.p12
```

Las contrasenas de los keystores deben estar en `.env`. El contenedor
`signserver-materials` detiene el despliegue si falta algun archivo.

El servicio de validacion se publica mediante `/validate/*` a traves de Nginx.

## Validaciones

```powershell
podman compose -f docker-compose.yml config --quiet
cd signserver-web
npm run build
```