# Flujo documental y seguridad

## Componentes

- `document-api`: API FastAPI de negocio en PostgreSQL.
- `business-db`: PostgreSQL separado del MariaDB interno de SignServer.
- `clamav`: inspeccion antivirus antes de persistir archivos.
- `signserver-app`: firma institucional con el certificado configurado en el worker.
- `signserver-web`: unico punto publico mediante Nginx.

## Configurar Microsoft Entra ID

1. Registra una aplicacion Web en Entra ID.
2. Configura como redirect URI:
   `https://DOMINIO_PUBLICO/auth/callback`.
3. Genera un client secret y guardalo solo en `.env`.
4. Usa el metadata URL del tenant:
   `https://login.microsoftonline.com/TENANT_ID/v2.0/.well-known/openid-configuration`.
5. Define `ADMIN_EMAILS` y `AUDITOR_EMAILS` en `.env` para el primer corte.
   Todos los usuarios nuevos quedan como `signer`.

En una siguiente iteracion conviene reemplazar las listas de correo por grupos
 o app roles de Entra, administrados desde el proveedor de identidad.

## Flujo

1. El usuario inicia sesion con Entra ID.
2. El backend crea o actualiza su registro local; no almacena contrasenas.
3. El admin sube un PDF.
4. Se valida MIME, magic bytes, tamano y ClamAV.
5. El admin asigna el documento a un usuario `signer`.
6. El signer ve solo sus asignaciones y confirma la firma.
7. El backend envia el PDF a SignServer, nunca el navegador.
8. Se guarda el PDF firmado, SHA-256, fecha, usuario, worker y evento de auditoria.
9. El auditor puede consultar la bitacora sin modificar documentos.

La firma criptografica es institucional: el usuario autenticado autoriza la
operacion, pero el certificado pertenece a la organizacion. Para firma
personal debe sustituirse el worker por un mecanismo de certificado individual
u HSM/remoto.

## Variables obligatorias

```dotenv
BUSINESS_DB_PASSWORD=...
SESSION_SECRET=...
OIDC_CLIENT_ID=...
OIDC_CLIENT_SECRET=...
OIDC_SERVER_METADATA_URL=...
ADMIN_EMAILS=...
AUDITOR_EMAILS=...
```

No publiques `.env`, archivos PKCS#12, claves privadas ni secretos de Entra.
