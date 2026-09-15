"""
Servicio de validación de documentos firmados.

No reemplaza a SignServer: lo complementa. SignServer firma; este
servicio *verifica* con herramientas estándar del sistema operativo,
independientes del worker que haya generado la firma:

  PDF      -> pdfsig (poppler-utils)
  JAR      -> jarsigner -verify (JDK)
  CMS      -> openssl cms -verify  (.p7s / PKCS#7)
  Debian   -> dpkg-sig --verify (fallback: gpg --verify sobre _gpgorigin)
  XML      -> xmlsec1 --verify  (XMLDSig/XAdES)

Cada archivo llega en base64 (mismo patrón que ya usa el frontend para
firmar), se escribe a un archivo temporal, se invoca la herramienta por
subprocess y se interpreta su salida. El archivo temporal se borra
siempre, tenga éxito o falle la verificación.

IMPORTANTE sobre confianza (trust): varias de estas verificaciones, tal
como están aquí, solo comprueban la INTEGRIDAD de la firma (que el
documento no se alteró y que la firma corresponde a la llave privada
usada), no que esa llave pertenezca a una entidad en la que confías.
Para validar la cadena de certificación completa hace falta apuntar
estas herramientas al certificado/CA de tu instancia SignServer -- se
deja indicado con un comentario "TODO-CONFIANZA" en cada validador.
"""

import base64
import os
import shutil
import subprocess
import tempfile
from typing import Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

app = FastAPI(title="SignServer - Servicio de validación", version="1.0.0")

# El frontend ya vive detrás del mismo nginx (mismo origen vía /validate/),
# pero se deja CORS abierto por si se consume desde otro lado durante
# desarrollo local (npm run dev).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


class ValidateRequest(BaseModel):
    data: str  # contenido del archivo en base64
    filename: Optional[str] = None
    encoding: str = "BASE64"


class ValidateResult(BaseModel):
    valid: bool
    format: str
    tool: str
    summary: str
    details: str


def run(cmd: list[str], timeout: int = 30) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)


def save_temp(data_b64: str, suffix: str) -> str:
    try:
        raw = base64.b64decode(data_b64, validate=True)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(400, f"El campo 'data' no es base64 válido: {exc}") from exc
    fd, path = tempfile.mkstemp(suffix=suffix)
    with os.fdopen(fd, "wb") as f:
        f.write(raw)
    return path


def cleanup(*paths: str) -> None:
    for path in paths:
        try:
            if os.path.isdir(path):
                shutil.rmtree(path, ignore_errors=True)
            else:
                os.remove(path)
        except OSError:
            pass


def missing_tool(name: str) -> HTTPException:
    return HTTPException(
        500,
        f"'{name}' no está instalado en el contenedor de validación. "
        f"Revisa el Dockerfile de validate-service.",
    )


@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/pdf", response_model=ValidateResult)
def validate_pdf(req: ValidateRequest):
    path = save_temp(req.data, ".pdf")
    try:
        proc = run(["pdfsig", path])
    except FileNotFoundError:
        raise missing_tool("pdfsig")
    finally:
        pass
    out = (proc.stdout or "") + (proc.stderr or "")
    cleanup(path)
    valid = "Signature Validation: Signature is Valid." in out
    return ValidateResult(
        valid=valid,
        format="PDF",
        tool="pdfsig (poppler-utils)",
        summary="Firma PDF válida" if valid else "Firma PDF inválida o no encontrada",
        details=out.strip() or "pdfsig no devolvió salida (¿el PDF no tiene firmas?).",
    )


@app.post("/jar", response_model=ValidateResult)
def validate_jar(req: ValidateRequest):
    path = save_temp(req.data, ".jar")
    try:
        proc = run(["jarsigner", "-verify", "-verbose", "-certs", path])
    except FileNotFoundError:
        cleanup(path)
        raise missing_tool("jarsigner (requiere un JDK)")
    out = (proc.stdout or "") + (proc.stderr or "")
    cleanup(path)
    valid = "jar verified." in out
    return ValidateResult(
        valid=valid,
        format="JAR",
        tool="jarsigner -verify",
        summary="JAR firmado y verificado" if valid else "JAR sin firma válida",
        details=out.strip() or "jarsigner no devolvió salida.",
    )


@app.post("/cms", response_model=ValidateResult)
def validate_cms(req: ValidateRequest):
    path = save_temp(req.data, ".p7s")
    try:
        # -noverify: valida la integridad de la firma pero NO la cadena
        # de confianza del certificado. TODO-CONFIANZA: agrega
        # -CAfile /ruta/a/tu-ca.pem y quita -noverify para validar la
        # cadena contra el certificado real de tu SignServer.
        proc = run(
            [
                "openssl", "cms", "-verify",
                "-in", path, "-inform", "DER",
                "-noverify",
                "-out", os.devnull,
            ]
        )
    except FileNotFoundError:
        cleanup(path)
        raise missing_tool("openssl")
    out = (proc.stdout or "") + (proc.stderr or "")
    cleanup(path)
    valid = proc.returncode == 0 and "Verification successful" in out
    note = (
        "\n\nNota: se validó solo la integridad de la firma (-noverify), "
        "no la cadena de confianza del certificado."
    )
    return ValidateResult(
        valid=valid,
        format="CMS (.p7s)",
        tool="openssl cms -verify",
        summary="Firma CMS válida" if valid else "Firma CMS inválida",
        details=(out.strip() or f"returncode={proc.returncode}") + note,
    )


@app.post("/deb", response_model=ValidateResult)
def validate_deb(req: ValidateRequest):
    path = save_temp(req.data, ".deb")
    extract_dir: Optional[str] = None
    try:
        if shutil.which("dpkg-sig"):
            proc = run(["dpkg-sig", "--verify", path])
            out = (proc.stdout or "") + (proc.stderr or "")
            valid = "GOODSIG" in out
            tool = "dpkg-sig --verify"
        else:
            # Fallback sin dpkg-sig: un .deb es un archivo `ar` con un
            # miembro _gpgorigin (la firma) sobre el resto del contenido.
            # TODO-CONFIANZA: importa antes la llave pública del worker
            # DebianDpkgSigSigner al keyring de gpg del contenedor
            # (gpg --import clave-publica.asc), si no, gpg reportará la
            # firma como de origen desconocido aunque sea íntegra.
            extract_dir = tempfile.mkdtemp()
            ar_proc = run(["ar", "x", path, "--output", extract_dir])
            if ar_proc.returncode != 0:
                raise HTTPException(422, f"No se pudo leer el .deb con ar: {ar_proc.stderr}")

            origin = os.path.join(extract_dir, "_gpgorigin")
            if not os.path.exists(origin):
                return ValidateResult(
                    valid=False,
                    format="Debian (.deb)",
                    tool="gpg --verify (fallback, dpkg-sig no instalado)",
                    summary="El paquete no tiene firma (_gpgorigin ausente)",
                    details="El .deb no contiene un miembro _gpgorigin firmado.",
                )

            data_member = next(
                (f for f in sorted(os.listdir(extract_dir)) if f.startswith("data.tar")),
                None,
            )
            gpg_cmd = ["gpg", "--verify", origin]
            if data_member:
                gpg_cmd.append(os.path.join(extract_dir, data_member))
            proc = run(gpg_cmd)
            out = (proc.stdout or "") + (proc.stderr or "")
            valid = proc.returncode == 0 and "Good signature" in out
            tool = "gpg --verify (fallback, dpkg-sig no instalado)"

        return ValidateResult(
            valid=valid,
            format="Debian (.deb)",
            tool=tool,
            summary="Paquete .deb firmado y verificado" if valid else "Firma inválida o ausente",
            details=out.strip() or "Sin salida de la herramienta.",
        )
    except FileNotFoundError as exc:
        raise missing_tool(str(exc))
    finally:
        cleanup(path, *( [extract_dir] if extract_dir else [] ))


@app.post("/xml", response_model=ValidateResult)
def validate_xml(req: ValidateRequest):
    path = save_temp(req.data, ".xml")
    try:
        # --insecure: no valida la cadena de confianza, solo la firma
        # XMLDSig/XAdES en sí. TODO-CONFIANZA: reemplaza por
        # --trusted-pem /ruta/a/tu-ca.pem (sin --insecure) para exigir
        # que el certificado firmante cuelgue de tu CA real.
        proc = run(["xmlsec1", "--verify", "--insecure", path])
    except FileNotFoundError:
        cleanup(path)
        raise missing_tool("xmlsec1")
    out = (proc.stdout or "") + (proc.stderr or "")
    cleanup(path)
    valid = proc.returncode == 0 and "OK" in out
    return ValidateResult(
        valid=valid,
        format="XML",
        tool="xmlsec1 --verify",
        summary="Firma XML válida" if valid else "Firma XML inválida",
        details=(out.strip() or f"returncode={proc.returncode}")
        + "\n\nNota: se usó --insecure, solo valida la firma, no la cadena de confianza.",
    )
