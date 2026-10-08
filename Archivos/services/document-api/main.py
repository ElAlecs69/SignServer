import base64
import hashlib
import io
import os
import secrets
import uuid
import asyncio
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated
from urllib.parse import urlparse

import clamd
import httpx
from pypdf import PdfReader, PdfWriter
from authlib.integrations.starlette_client import OAuth
from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from pydantic import BaseModel
from sqlalchemy import DateTime, ForeignKey, String, Text, create_engine, func, select, text
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, sessionmaker
from starlette.middleware.sessions import SessionMiddleware

DATABASE_URL = os.environ["DATABASE_URL"]
APP_PUBLIC_URL = os.getenv("APP_PUBLIC_URL", "").rstrip("/")
DOCUMENTS_DIR = Path(os.getenv("DOCUMENTS_DIR", "/data/documents"))
SIGN_SERVER_URL = os.getenv("SIGN_SERVER_URL", "http://signserver-app:8080/signserver")
SIGN_SERVER_WORKER = os.getenv("SIGN_SERVER_WORKER", "PDFSigner")
VALIDATE_SERVICE_URL = os.getenv("VALIDATE_SERVICE_URL", "http://signserver-validate:8000").rstrip("/")
CLAMAV_HOST = os.getenv("CLAMAV_HOST", "clamav")
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(25 * 1024 * 1024)))
DOCUMENT_INTELLIGENCE_ENDPOINT = os.getenv("DOCUMENT_INTELLIGENCE_ENDPOINT", "").rstrip("/")
DOCUMENT_INTELLIGENCE_KEY = os.getenv("DOCUMENT_INTELLIGENCE_KEY", "")
DOCUMENT_INTELLIGENCE_API_VERSION = "2023-07-31"
SESSION_SECRET = os.environ["SESSION_SECRET"]
SESSION_COOKIE_SECURE = os.getenv("SESSION_COOKIE_SECURE", "false").lower() == "true"
OIDC_CLIENT_ID = os.environ["OIDC_CLIENT_ID"]
OIDC_CLIENT_SECRET = os.environ["OIDC_CLIENT_SECRET"]
OIDC_SERVER_METADATA_URL = os.environ["OIDC_SERVER_METADATA_URL"]
OIDC_REDIRECT_URI = os.getenv("OIDC_REDIRECT_URI", "")
DEMO_AUTH_ENABLED = os.getenv("DEMO_AUTH_ENABLED", "false").lower() == "true"
DEMO_ACCOUNTS = {
    "admin@demo.test": {"password": "demo123", "role": "admin"},
    "demo@example.com": {"password": "demo123", "role": "signer"},
}
# Modo de pruebas: mientras DEMO_AUTH_ENABLED esté activo, cualquier correo con esta
# contraseña puede entrar y se auto-provisiona (útil para demo1@, demo2@, ..., demoN@
# sin tener que dar de alta cada cuenta a mano). El rol se adivina por el correo:
# "admin*" -> admin, "audit*"/"auditor*" -> auditor, cualquier otro -> DEFAULT_NEW_USER_ROLE.
# Pon DEMO_AUTH_ALLOW_ANY=false para exigir únicamente las cuentas fijas de DEMO_ACCOUNTS.
DEMO_AUTH_ALLOW_ANY = os.getenv("DEMO_AUTH_ALLOW_ANY", "true").lower() == "true"
DEMO_AUTH_PASSWORD = os.getenv("DEMO_AUTH_PASSWORD", "demo123")


def guess_demo_role(email: str) -> str:
    local_part = email.split("@", 1)[0]
    if local_part.startswith("admin"):
        return "admin"
    if local_part.startswith("audit"):
        return "auditor"
    return os.getenv("DEFAULT_NEW_USER_ROLE", "signer")

DOCUMENTS_DIR.mkdir(parents=True, exist_ok=True)
engine = create_engine(DATABASE_URL, pool_pre_ping=True)
SessionLocal = sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "app_users"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    oidc_sub: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    email: Mapped[str] = mapped_column(String(320))
    display_name: Mapped[str] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(32), default="signer")


class Document(Base):
    __tablename__ = "documents"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    original_name: Mapped[str] = mapped_column(String(255))
    stored_path: Mapped[str] = mapped_column(String(500))
    signed_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    sha256: Mapped[str] = mapped_column(String(64))
    signed_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="pending")
    size_bytes: Mapped[int] = mapped_column(default=0)
    uploaded_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("app_users.id"))
    uploaded_from_ip: Mapped[str] = mapped_column(String(64), default="unknown")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    deleted_by: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("app_users.id"), nullable=True)


class Assignment(Base):
    __tablename__ = "document_assignments"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    document_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("documents.id"), index=True)
    signer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app_users.id"), index=True)
    assigned_by_user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("app_users.id"), nullable=True)
    status: Mapped[str] = mapped_column(String(32), default="pending")
    assigned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    assigned_from_ip: Mapped[str] = mapped_column(String(64), default="unknown")
    received_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    received_from_ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    signed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    signed_by_ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Cada asignación guarda SU PROPIA copia firmada. Es indispensable cuando el
    # mismo documento se envía en masa a varios firmantes: si todos compartieran el
    # signed_path del Document, la firma del último en firmar pisaría la de los demás.
    signed_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    signed_sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    last_downloaded_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_downloaded_ip: Mapped[str | None] = mapped_column(String(64), nullable=True)


class AuditEvent(Base):
    """
    Pista de auditoría de solo-anexado (append-only). Cada evento queda encadenado
    criptográficamente al anterior (prev_hash / event_hash) para que cualquier
    alteración o borrado posterior de un registro sea detectable — el mismo
    principio que exigen los estándares de trazabilidad forense/corporativa
    (p. ej. ISO/IEC 27001 A.8.15, NIST SP 800-92, eIDAS Art. 24 sobre
    conservación de evidencia de firma).
    """
    __tablename__ = "audit_events"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    # Nulo únicamente cuando el evento ocurre ANTES de resolver identidad (p. ej. login fallido)
    actor_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("app_users.id"), nullable=True)
    # Correo/identificador legible, capturado siempre (incluso si el usuario no llegó a autenticarse
    # o si el usuario es borrado más adelante, el rastro de auditoría no debe depender de esa FK)
    actor_email: Mapped[str] = mapped_column(String(320), default="unknown")
    action: Mapped[str] = mapped_column(String(80))
    document_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("documents.id"), nullable=True)
    ip_address: Mapped[str] = mapped_column(String(64))
    details: Mapped[str] = mapped_column(Text, default="")
    # SUCCESS | FAILED — para distinguir intentos denegados de acciones completadas
    status: Mapped[str] = mapped_column(String(16), default="SUCCESS")
    # Origen de la petición: interfaz web vs. API REST directa (Bearer token) / herramienta automatizada
    client: Mapped[str] = mapped_column(String(32), default="web")
    user_agent: Mapped[str] = mapped_column(String(500), default="")
    prev_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    event_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


def ensure_schema() -> None:
    with engine.begin() as conn:
        document_columns = {row[0] for row in conn.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name = 'documents'"))}
        if "size_bytes" not in document_columns:
            conn.execute(text("ALTER TABLE documents ADD COLUMN size_bytes INTEGER NOT NULL DEFAULT 0"))
        if "uploaded_from_ip" not in document_columns:
            conn.execute(text("ALTER TABLE documents ADD COLUMN uploaded_from_ip VARCHAR(64) NOT NULL DEFAULT 'unknown'"))
        if "deleted_at" not in document_columns:
            conn.execute(text("ALTER TABLE documents ADD COLUMN deleted_at TIMESTAMPTZ NULL"))
        if "deleted_by" not in document_columns:
            conn.execute(text("ALTER TABLE documents ADD COLUMN deleted_by UUID NULL"))

        assignment_columns = {row[0] for row in conn.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name = 'document_assignments'"))}
        if "signed_path" not in assignment_columns:
            conn.execute(text("ALTER TABLE document_assignments ADD COLUMN signed_path VARCHAR(500) NULL"))
        if "signed_sha256" not in assignment_columns:
            conn.execute(text("ALTER TABLE document_assignments ADD COLUMN signed_sha256 VARCHAR(64) NULL"))

        audit_columns = {row[0] for row in conn.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name = 'audit_events'"))}
        conn.execute(text("ALTER TABLE audit_events ALTER COLUMN actor_id DROP NOT NULL"))
        for column_name, ddl in {
            "actor_email": "ALTER TABLE audit_events ADD COLUMN actor_email VARCHAR(320) NOT NULL DEFAULT 'unknown'",
            "status": "ALTER TABLE audit_events ADD COLUMN status VARCHAR(16) NOT NULL DEFAULT 'SUCCESS'",
            "client": "ALTER TABLE audit_events ADD COLUMN client VARCHAR(32) NOT NULL DEFAULT 'web'",
            "user_agent": "ALTER TABLE audit_events ADD COLUMN user_agent VARCHAR(500) NOT NULL DEFAULT ''",
            "prev_hash": "ALTER TABLE audit_events ADD COLUMN prev_hash VARCHAR(64) NULL",
            "event_hash": "ALTER TABLE audit_events ADD COLUMN event_hash VARCHAR(64) NULL",
        }.items():
            if column_name not in audit_columns:
                conn.execute(text(ddl))
        # Backfill best-effort: registros históricos (previos a esta versión) no tenían actor_email;
        # se completa desde app_users para no perder legibilidad en la bitácora existente.
        conn.execute(text(
            "UPDATE audit_events SET actor_email = app_users.email "
            "FROM app_users WHERE audit_events.actor_id = app_users.id AND audit_events.actor_email = 'unknown'"
        ))

        assignment_columns = {row[0] for row in conn.execute(text("SELECT column_name FROM information_schema.columns WHERE table_name = 'document_assignments'"))}
        for column_name, ddl in {
            "assigned_by_user_id": "ALTER TABLE document_assignments ADD COLUMN assigned_by_user_id UUID NULL",
            "assigned_from_ip": "ALTER TABLE document_assignments ADD COLUMN assigned_from_ip VARCHAR(64) NOT NULL DEFAULT 'unknown'",
            "received_at": "ALTER TABLE document_assignments ADD COLUMN received_at TIMESTAMPTZ NULL",
            "received_from_ip": "ALTER TABLE document_assignments ADD COLUMN received_from_ip VARCHAR(64) NULL",
            "signed_by_ip": "ALTER TABLE document_assignments ADD COLUMN signed_by_ip VARCHAR(64) NULL",
            "last_downloaded_at": "ALTER TABLE document_assignments ADD COLUMN last_downloaded_at TIMESTAMPTZ NULL",
            "last_downloaded_ip": "ALTER TABLE document_assignments ADD COLUMN last_downloaded_ip VARCHAR(64) NULL",
        }.items():
            if column_name not in assignment_columns:
                conn.execute(text(ddl))

Base.metadata.create_all(engine)
ensure_schema()
app = FastAPI(title="SignServer Document API")
limiter = Limiter(key_func=get_remote_address, default_limits=["120/minute"])
app.state.limiter = limiter


async def rate_limit_handler(request: Request, exc: RateLimitExceeded):
    # Señal clave para detectar fuerza bruta / abuso automatizado: se deja constancia
    # en la bitácora aunque no exista una sesión de usuario válida todavía.
    audit_standalone("security.rate_limit_exceeded", request, details=f"path={request.url.path}")
    return _rate_limit_exceeded_handler(request, exc)


app.add_exception_handler(RateLimitExceeded, rate_limit_handler)
app.add_middleware(SessionMiddleware, secret_key=SESSION_SECRET, max_age=900, same_site="lax", https_only=SESSION_COOKIE_SECURE)
app.add_middleware(CORSMiddleware, allow_origins=[], allow_credentials=True)

oauth = OAuth()
oauth.register(
    name="entra",
    client_id=OIDC_CLIENT_ID,
    client_secret=OIDC_CLIENT_SECRET,
    server_metadata_url=OIDC_SERVER_METADATA_URL,
    client_kwargs={"scope": "openid profile email"},
)


def db_session():
    with SessionLocal() as db:
        yield db


def current_user(request: Request, db: Session = Depends(db_session)) -> User:
    identity = request.session.get("identity")
    if not identity:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Autenticacion requerida")
    user = db.scalar(select(User).where(User.oidc_sub == identity["sub"]))
    if not user:
        raise HTTPException(status_code=403, detail="Usuario no aprovisionado")
    return user


def require_role(*roles: str):
    def dependency(user: User = Depends(current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(status_code=403, detail="Rol insuficiente")
        return user
    return dependency


def compute_event_hash(prev_hash: str, actor_id, actor_email: str, action: str, document_id, status_: str, ip: str, details: str, user_agent: str, created_at: datetime) -> str:
    payload = "|".join([
        prev_hash,
        str(actor_id) if actor_id else "",
        actor_email or "",
        action,
        str(document_id) if document_id else "",
        status_,
        ip,
        details,
        user_agent or "",
        created_at.isoformat(),
    ])
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


GENESIS_HASH = "0" * 64


def request_client_kind(request: Request | None) -> str:
    if request is None:
        return "system"
    if request.headers.get("authorization"):
        return "api"
    return "web"


def audit(
    db: Session,
    actor: User | None,
    action: str,
    request: Request | None,
    document_id=None,
    details: str = "",
    status: str = "SUCCESS",
    actor_email: str | None = None,
) -> None:
    """
    Registra un evento en la bitácora de auditoría, encadenado al evento anterior
    (hash chain tipo "libro contable") para que cualquier modificación o borrado
    de un registro previo rompa visiblemente la cadena. Ver /api/audit/verify.
    """
    ip = (request.client.host if request and request.client else "unknown")
    user_agent = (request.headers.get("user-agent", "") if request else "")[:500]
    email = actor_email or (actor.email if actor else "unknown")
    actor_id = actor.id if actor else None
    prev_hash = db.execute(
        select(AuditEvent.event_hash).order_by(AuditEvent.created_at.desc(), AuditEvent.id.desc()).limit(1)
    ).scalar() or GENESIS_HASH
    created_at = datetime.now(timezone.utc)
    event_hash = compute_event_hash(prev_hash, actor_id, email, action, document_id, status, ip, details, user_agent, created_at)
    db.add(AuditEvent(
        actor_id=actor_id,
        actor_email=email,
        action=action,
        document_id=document_id,
        ip_address=ip,
        details=details,
        status=status,
        client=request_client_kind(request),
        user_agent=user_agent,
        prev_hash=prev_hash,
        event_hash=event_hash,
        created_at=created_at,
    ))


def audit_standalone(action: str, request: Request | None, actor_email: str = "unknown", details: str = "", status: str = "FAILED") -> None:
    """Para eventos que ocurren fuera de una sesión de DB de la petición (p. ej. límite de tasa excedido)."""
    try:
        with SessionLocal() as db:
            audit(db, None, action, request, details=details, status=status, actor_email=actor_email)
            db.commit()
    except Exception:
        pass


def require_csrf(request: Request):
    token = request.headers.get("X-CSRF-Token")
    if not token or not secrets.compare_digest(token, request.session.get("csrf", "")):
        raise HTTPException(status_code=403, detail="CSRF token invalido")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.api_route("/auth/login", methods=["GET", "POST"])
@limiter.limit("10/minute")
async def login(request: Request):
    if request.method == "POST":
        form = await request.form()
        email = str(form.get("email", "")).strip().lower()
        password = str(form.get("password", "")).strip()
    else:
        email = request.query_params.get("email", "").strip().lower()
        password = request.query_params.get("password", "").strip()

    if DEMO_AUTH_ENABLED:
        if not email or "@" not in email or not password:
            audit_standalone("auth.login.failed", request, actor_email=email or "unknown", details="reason=missing_credentials")
            raise HTTPException(400, "Escribe un correo y una contraseña de prueba")
        expected = DEMO_ACCOUNTS.get(email)
        if expected:
            valid = password == expected["password"]
        elif DEMO_AUTH_ALLOW_ANY:
            valid = password == DEMO_AUTH_PASSWORD
        else:
            valid = False
        if not valid:
            audit_standalone("auth.login.failed", request, actor_email=email, details="reason=invalid_credentials")
            raise HTTPException(401, "Credenciales de prueba invalidas")
        return await create_demo_session(request, email)

    redirect_uri = OIDC_REDIRECT_URI or request.url_for("auth_callback")
    return await oauth.entra.authorize_redirect(request, redirect_uri)


async def create_demo_session(request: Request, email: str):
    email = email.strip().lower()
    account = DEMO_ACCOUNTS.get(email)
    role = account["role"] if account else guess_demo_role(email)
    with SessionLocal() as db:
        sub = f"demo:{email}"
        user = db.scalar(select(User).where(User.oidc_sub == sub))
        if not user:
            user = User(oidc_sub=sub, email=email, display_name=email.split("@", 1)[0], role=role)
            db.add(user)
        else:
            user.email = email
            user.display_name = email.split("@", 1)[0]
            user.role = role
        db.flush()
        audit(db, user, "auth.login.success", request, details=f"method=demo;role={user.role}")
        db.commit()
    request.session["identity"] = {"sub": sub}
    request.session["csrf"] = secrets.token_urlsafe(32)
    return RedirectResponse("/")


@app.get("/auth/callback", name="auth_callback")
async def auth_callback(request: Request, db: Session = Depends(db_session)):
    token = await oauth.entra.authorize_access_token(request)
    userinfo = token.get("userinfo") or await oauth.entra.userinfo(token=token)
    sub = userinfo["sub"]
    user = db.scalar(select(User).where(User.oidc_sub == sub))
    if not user:
        email = userinfo.get("email", userinfo.get("preferred_username", ""))
        admins = {item.strip().lower() for item in os.getenv("ADMIN_EMAILS", "").split(",") if item.strip()}
        auditors = {item.strip().lower() for item in os.getenv("AUDITOR_EMAILS", "").split(",") if item.strip()}
        role = "admin" if email.lower() in admins else "auditor" if email.lower() in auditors else os.getenv("DEFAULT_NEW_USER_ROLE", "signer")
        user = User(oidc_sub=sub, email=email, display_name=userinfo.get("name", ""), role=role)
        db.add(user)
    else:
        user.email = userinfo.get("email", user.email)
        user.display_name = userinfo.get("name", user.display_name)
    db.flush()
    audit(db, user, "auth.login.success", request, details=f"method=oidc;role={user.role}")
    db.commit()
    request.session["identity"] = {"sub": sub}
    request.session["csrf"] = secrets.token_urlsafe(32)
    return RedirectResponse("/")


@app.get("/api/csrf")
def csrf(request: Request, user: User = Depends(current_user)):
    request.session.setdefault("csrf", secrets.token_urlsafe(32))
    return {"token": request.session["csrf"]}


@app.post("/api/formats/analyze")
@limiter.limit("5/minute")
async def analyze_format_layout(
    request: Request,
    file: Annotated[UploadFile, File(...)],
    _csrf=Depends(require_csrf),
    user: User = Depends(current_user),
):
    if not DOCUMENT_INTELLIGENCE_ENDPOINT or not DOCUMENT_INTELLIGENCE_KEY:
        raise HTTPException(503, "Azure Document Intelligence no está configurado en el servidor.")
    if urlparse(DOCUMENT_INTELLIGENCE_ENDPOINT).scheme != "https":
        raise HTTPException(503, "El endpoint de Azure Document Intelligence debe usar HTTPS.")
    if file.content_type != "application/pdf":
        raise HTTPException(415, "Solo se pueden analizar formatos PDF.")

    source = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(source) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "El formato excede el tamaño máximo permitido para análisis.")
    if not source.startswith(b"%PDF-"):
        raise HTTPException(415, "El archivo no es un PDF válido.")
    try:
        reader = PdfReader(io.BytesIO(source), strict=False)
        if reader.is_encrypted:
            raise HTTPException(422, "No se pueden analizar PDFs protegidos con contraseña.")
        page_count = len(reader.pages)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(415, "No se pudo leer la estructura del PDF.") from exc
    if page_count == 0:
        raise HTTPException(422, "El PDF no contiene páginas para analizar.")

    pages: list[dict] = []
    tables: list[dict] = []
    pairs: list[dict] = []
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(90, connect=10)) as client:
            for first_page in range(0, page_count, 2):
                writer = PdfWriter()
                for page_index in range(first_page, min(first_page + 2, page_count)):
                    writer.add_page(reader.pages[page_index])
                chunk = io.BytesIO()
                writer.write(chunk)
                result = await _analyze_layout_chunk(client, chunk.getvalue())
                local_pages = result.get("pages", [])
                for page in local_pages:
                    page_number = int(page.get("pageNumber", 0))
                    page_index = first_page + page_number - 1
                    if page_index < first_page or page_index >= page_count:
                        continue
                    unit = page.get("unit", "inch")
                    scale = 72.0 if unit == "inch" else 1.0
                    page_height = float(page.get("height", 0))
                    pages.append({
                        "pageIndex": page_index,
                        "width": float(page.get("width", 0)) * scale,
                        "height": page_height * scale,
                        "lines": [
                            {
                                "text": line.get("content", ""),
                                "bounds": _polygon_bounds(
                                    line.get("polygon", []),
                                    page_height,
                                    unit,
                                ),
                            }
                            for line in page.get("lines", [])
                            if line.get("content") and line.get("polygon")
                        ],
                        "words": [
                            {
                                "text": word.get("content", ""),
                                "bounds": _polygon_bounds(
                                    word.get("polygon", []),
                                    page_height,
                                    unit,
                                ),
                            }
                            for line in page.get("lines", [])
                            for word in line.get("words", [])
                            if word.get("content") and word.get("polygon")
                        ],
                    })
                for table in result.get("tables", []):
                    for region in table.get("boundingRegions", []):
                        page_index = first_page + int(region.get("pageNumber", 0)) - 1
                        if page_index < first_page or page_index >= page_count:
                            continue
                        table_page = next((page for page in local_pages if page.get("pageNumber") == page_index - first_page + 1), None)
                        if not table_page:
                            continue
                        unit = table_page.get("unit", "inch")
                        page_height = float(table_page.get("height", 0))
                        tables.append({
                            "pageIndex": page_index,
                            "rowCount": int(table.get("rowCount", 0)),
                            "columnCount": int(table.get("columnCount", 0)),
                            "cells": [
                                {
                                    "rowIndex": int(cell.get("rowIndex", 0)),
                                    "columnIndex": int(cell.get("columnIndex", 0)),
                                    "rowSpan": int(cell.get("rowSpan", 1)),
                                    "columnSpan": int(cell.get("columnSpan", 1)),
                                    "text": cell.get("content", ""),
                                    "bounds": _polygon_bounds(
                                        cell_region.get("polygon", []),
                                        page_height,
                                        unit,
                                    ),
                                }
                                for cell in table.get("cells", [])
                                for cell_region in cell.get("boundingRegions", [])
                                if cell_region.get("pageNumber") == region.get("pageNumber")
                                and cell_region.get("polygon")
                            ],
                        })
                for pair in result.get("keyValuePairs", []):
                    key = pair.get("key", {})
                    value = pair.get("value", {})
                    for region in value.get("boundingRegions", []):
                        page_index = first_page + int(region.get("pageNumber", 0)) - 1
                        page = next((item for item in local_pages if item.get("pageNumber") == page_index - first_page + 1), None)
                        if not page or not region.get("polygon"):
                            continue
                        pairs.append({
                            "pageIndex": page_index,
                            "key": key.get("content", ""),
                            "value": value.get("content", ""),
                            "bounds": _polygon_bounds(
                                region.get("polygon", []),
                                float(page.get("height", 0)),
                                page.get("unit", "inch"),
                            ),
                        })
    except httpx.HTTPError as exc:
        raise HTTPException(502, "No se pudo conectar con Azure Document Intelligence.") from exc

    audit_db = SessionLocal()
    try:
        audit(audit_db, user, "document.layout.analyzed", request, details=f"pages={page_count};provider=azure-document-intelligence")
        audit_db.commit()
    finally:
        audit_db.close()
    pages.sort(key=lambda page: page["pageIndex"])
    return {"pages": pages, "tables": tables, "keyValuePairs": pairs}


@app.post("/auth/logout")
def logout(request: Request, _csrf=Depends(require_csrf), db: Session = Depends(db_session)):
    identity = request.session.get("identity")
    if identity:
        user = db.scalar(select(User).where(User.oidc_sub == identity["sub"]))
        if user:
            audit(db, user, "auth.logout", request)
            db.commit()
    request.session.clear()
    return {"ok": True}


class AssignmentRequest(BaseModel):
    signer_email: str


class BulkAssignmentRequest(BaseModel):
    signer_emails: list[str] = []
    all_signers: bool = False


# Listas blancas para el modo de "firma directa / validación directa": el frontend
# permite elegir un worker o un formato de validación, pero el backend nunca debe
# reenviar a SignServer o al servicio de validación un identificador arbitrario que
# venga del cliente (evita SSRF/abuso del worker y mantiene la bitácora consistente
# con lo que realmente existe en la instancia de SignServer).
DIRECT_SIGN_WORKERS = {
    "PDFSigner", "CMSSigner", "XMLSigner", "JArchiveSigner",
    "DebianDpkgSigSigner", "TimeStampSigner", "MRTDSigner", "MRTDSODSigner",
}
DIRECT_VALIDATE_FORMATS = {"pdf", "cms", "xml", "jar", "deb", "crl"}


class DirectSignRequest(BaseModel):
    worker: str
    filename: str
    data: str  # contenido en base64


class DirectValidateRequest(BaseModel):
    format: str  # uno de DIRECT_VALIDATE_FORMATS
    filename: str
    data: str  # contenido en base64


def _polygon_bounds(polygon: list[float], page_height: float, unit: str) -> dict[str, float] | None:
    if len(polygon) < 8 or len(polygon) % 2:
        return None
    scale = 72.0 if unit == "inch" else 1.0
    xs = [float(value) * scale for value in polygon[::2]]
    ys = [float(value) * scale for value in polygon[1::2]]
    left, right = min(xs), max(xs)
    top, bottom = min(ys), max(ys)
    page_height_points = page_height * scale
    return {
        "x": left,
        "y": page_height_points - bottom,
        "width": right - left,
        "height": bottom - top,
    }


async def _analyze_layout_chunk(
    client: httpx.AsyncClient,
    pdf_chunk: bytes,
) -> dict:
    analyze_url = (
        f"{DOCUMENT_INTELLIGENCE_ENDPOINT}/formrecognizer/documentModels/prebuilt-layout:analyze"
        f"?api-version={DOCUMENT_INTELLIGENCE_API_VERSION}&features=keyValuePairs"
    )
    response = await client.post(
        analyze_url,
        headers={
            "Ocp-Apim-Subscription-Key": DOCUMENT_INTELLIGENCE_KEY,
            "Content-Type": "application/pdf",
        },
        content=pdf_chunk,
    )
    if response.status_code != 202:
        raise HTTPException(502, "Azure Document Intelligence no pudo iniciar el análisis del PDF.")
    operation_url = response.headers.get("operation-location")
    if not operation_url:
        raise HTTPException(502, "Azure Document Intelligence no devolvió el identificador de análisis.")
    if urlparse(operation_url).netloc.lower() != urlparse(DOCUMENT_INTELLIGENCE_ENDPOINT).netloc.lower():
        raise HTTPException(502, "Azure Document Intelligence devolvió un destino de análisis no válido.")

    for _ in range(120):
        await asyncio.sleep(0.5)
        result_response = await client.get(
            operation_url,
            headers={"Ocp-Apim-Subscription-Key": DOCUMENT_INTELLIGENCE_KEY},
        )
        if result_response.status_code != 200:
            raise HTTPException(502, "No se pudo consultar el resultado del análisis documental.")
        result = result_response.json()
        status_value = result.get("status")
        if status_value == "succeeded":
            return result.get("analyzeResult", {})
        if status_value in {"failed", "canceled"}:
            raise HTTPException(502, "Azure Document Intelligence no pudo analizar este formato.")
    raise HTTPException(504, "El análisis del documento excedió el tiempo de espera.")


class ClientAuditEventRequest(BaseModel):
    action: str
    details: str = ""


# Eventos que el cliente (navegador) puede reportar directamente. Se restringe a una
# lista blanca para que este endpoint no se pueda usar para inyectar entradas
# arbitrarias en una bitácora que debe ser confiable.
ALLOWED_CLIENT_ACTIONS = {"document.designed", "document.designed.downloaded"}


@app.get("/api/me")
def me(user: User = Depends(current_user)):
    return {"id": str(user.id), "email": user.email, "name": user.display_name, "role": user.role}


@app.get("/api/users")
def users(_admin: User = Depends(require_role("admin")), db: Session = Depends(db_session)):
    return [{"id": str(user.id), "email": user.email, "name": user.display_name} for user in db.scalars(select(User).where(User.role == "signer").order_by(User.email)).all()]


@app.post("/api/documents")
@limiter.limit("10/minute")
async def upload_document(request: Request, file: Annotated[UploadFile, File(...)], _csrf=Depends(require_csrf), admin: User = Depends(require_role("admin")), db: Session = Depends(db_session)):
    if file.content_type != "application/pdf":
        raise HTTPException(415, "Solo se aceptan documentos PDF")
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES or not data.startswith(b"%PDF-"):
        raise HTTPException(413 if len(data) > MAX_UPLOAD_BYTES else 415, "Archivo PDF invalido o demasiado grande")
    try:
        scanner = clamd.ClamdNetworkSocket(host=CLAMAV_HOST, port=3310, timeout=10)
        if scanner.instream(io.BytesIO(data))["stream"][0] != "OK":
            raise HTTPException(422, "El antivirus rechazo el archivo")
    except clamd.ConnectionError as exc:
        raise HTTPException(503, "El antivirus no esta disponible") from exc
    document_id = uuid.uuid4()
    path = DOCUMENTS_DIR / f"{document_id}.pdf"
    path.write_bytes(data)
    source_ip = request.client.host if request.client else "unknown"
    document = Document(
        id=document_id,
        original_name=file.filename or "documento.pdf",
        stored_path=str(path),
        sha256=hashlib.sha256(data).hexdigest(),
        size_bytes=len(data),
        uploaded_by=admin.id,
        uploaded_from_ip=source_ip,
    )
    db.add(document)
    db.flush()
    audit(db, admin, "document.uploaded", request, document_id, f"filename={document.original_name};size_bytes={document.size_bytes};ip={source_ip}")
    db.commit()
    return {"id": str(document_id), "name": document.original_name, "sha256": document.sha256, "size_bytes": document.size_bytes}


@app.post("/api/documents/{document_id}/assign")
@limiter.limit("30/minute")
def assign_document(document_id: uuid.UUID, payload: AssignmentRequest, request: Request, _csrf=Depends(require_csrf), admin: User = Depends(require_role("admin")), db: Session = Depends(db_session)):
    document = db.get(Document, document_id)
    signer = db.scalar(select(User).where(User.email == payload.signer_email))
    if not document or document.deleted_at or not signer or signer.role != "signer":
        audit(db, admin, "document.assign.failed", request, document_id if document else None, f"signer={payload.signer_email};reason=not_found", status="FAILED")
        db.commit()
        raise HTTPException(404, "Documento o firmante no encontrado")
    source_ip = request.client.host if request.client else "unknown"
    assignment = Assignment(
        document_id=document.id,
        signer_id=signer.id,
        assigned_by_user_id=admin.id,
        assigned_from_ip=source_ip,
    )
    db.add(assignment)
    db.flush()
    audit(db, admin, "document.assigned", request, document.id, f"signer={signer.email};file={document.original_name};size_bytes={document.size_bytes};ip={source_ip}")
    db.commit()
    return {"assignment_id": str(assignment.id), "status": assignment.status}


@app.post("/api/documents/{document_id}/assign-bulk")
@limiter.limit("10/minute")
def assign_document_bulk(document_id: uuid.UUID, payload: BulkAssignmentRequest, request: Request, _csrf=Depends(require_csrf), admin: User = Depends(require_role("admin")), db: Session = Depends(db_session)):
    """Asigna un mismo documento a varios firmantes de una sola vez ("enviar en masa")."""
    document = db.get(Document, document_id)
    if not document or document.deleted_at:
        audit(db, admin, "document.assign.failed", request, document_id, "reason=document_not_found;modo=masivo", status="FAILED")
        db.commit()
        raise HTTPException(404, "Documento no encontrado")

    if payload.all_signers:
        signers = db.scalars(select(User).where(User.role == "signer")).all()
    else:
        emails = {email.strip().lower() for email in payload.signer_emails if email.strip()}
        if not emails:
            raise HTTPException(400, "Indica al menos un firmante o marca 'todos'")
        signers = db.scalars(select(User).where(User.role == "signer", func.lower(User.email).in_(emails))).all()

    if not signers:
        audit(db, admin, "document.assign.failed", request, document.id, "reason=no_signers_found;modo=masivo", status="FAILED")
        db.commit()
        raise HTTPException(404, "No se encontraron firmantes válidos")

    # Evita duplicar una asignación ya existente (pendiente o firmada) para el mismo par documento/firmante.
    already_assigned = {
        row[0] for row in db.execute(select(Assignment.signer_id).where(Assignment.document_id == document.id))
    }
    source_ip = request.client.host if request.client else "unknown"
    created_ids: list[str] = []
    skipped_emails: list[str] = []
    for signer in signers:
        if signer.id in already_assigned:
            skipped_emails.append(signer.email)
            continue
        assignment = Assignment(
            document_id=document.id,
            signer_id=signer.id,
            assigned_by_user_id=admin.id,
            assigned_from_ip=source_ip,
        )
        db.add(assignment)
        db.flush()
        created_ids.append(str(assignment.id))

    audit(
        db, admin, "document.assigned.bulk", request, document.id,
        f"file={document.original_name};size_bytes={document.size_bytes};firmantes_nuevos={len(created_ids)};"
        f"omitidos_ya_asignados={len(skipped_emails)};emails_omitidos={','.join(skipped_emails)};ip={source_ip}",
    )
    db.commit()
    return {"assigned": len(created_ids), "skipped": skipped_emails, "assignment_ids": created_ids}


@app.get("/api/assignments")
def assignments(user: User = Depends(current_user), db: Session = Depends(db_session)):
    query = select(Assignment, Document).join(Document, Assignment.document_id == Document.id).where(Document.deleted_at.is_(None))
    if user.role == "signer":
        query = query.where(Assignment.signer_id == user.id)
    rows = db.execute(query.order_by(Assignment.assigned_at.desc())).all()
    return [{"id": str(a.id), "document_id": str(d.id), "name": d.original_name, "status": a.status, "sha256": d.sha256} for a, d in rows]


@app.post("/api/assignments/{assignment_id}/sign")
@limiter.limit("10/minute")
async def sign_assignment(assignment_id: uuid.UUID, request: Request, _csrf=Depends(require_csrf), user: User = Depends(require_role("signer")), db: Session = Depends(db_session)):
    assignment = db.get(Assignment, assignment_id)
    if not assignment or assignment.signer_id != user.id or assignment.status != "pending":
        audit(db, user, "document.sign.failed", request, assignment.document_id if assignment else None, "reason=assignment_not_available", status="FAILED")
        db.commit()
        raise HTTPException(404, "Asignacion no disponible")
    document = db.get(Document, assignment.document_id)
    data = Path(document.stored_path).read_bytes()
    async with httpx.AsyncClient(timeout=120, verify=False) as client:
        response = await client.post(f"{SIGN_SERVER_URL}/rest/v1/workers/{SIGN_SERVER_WORKER}/process", json={"data": base64.b64encode(data).decode(), "encoding": "BASE64"})
    if response.status_code >= 400:
        error_body = response.text[:500]
        lowered = error_body.lower()
        # SignServer reporta en el cuerpo del error si el certificado del worker expiró
        # o si el token/keystore fue revocado; se distingue para alertar de forma específica.
        if "expired" in lowered or "not yet valid" in lowered or "vencid" in lowered:
            event = "certificate.expired"
        elif "revoked" in lowered or "revocad" in lowered:
            event = "worker.revoked"
        else:
            event = "document.sign.failed"
        audit(db, user, event, request, document.id, f"worker={SIGN_SERVER_WORKER};http_status={response.status_code};error={error_body}", status="FAILED")
        db.commit()
        raise HTTPException(502, "SignServer no pudo firmar el documento")
    signed = base64.b64decode(response.json()["data"], validate=True)
    signed_path = DOCUMENTS_DIR / f"{assignment.id}.signed.pdf"
    signed_path.write_bytes(signed)
    source_ip = request.client.host if request.client else "unknown"
    assignment.signed_path = str(signed_path)
    assignment.signed_sha256 = hashlib.sha256(signed).hexdigest()
    assignment.status = "signed"
    # document.status/signed_path quedan como referencia general (última firma recibida);
    # cada firmante conserva SIEMPRE su propia copia en assignment.signed_path.
    document.status = "signed"
    document.signed_path = str(signed_path)
    document.signed_sha256 = assignment.signed_sha256
    assignment.signed_at = datetime.now(timezone.utc)
    assignment.signed_by_ip = source_ip
    audit(db, user, "document.signed", request, document.id, f"worker={SIGN_SERVER_WORKER};sha256={assignment.signed_sha256};ip={source_ip}")
    db.commit()
    return {"status": "signed", "sha256": assignment.signed_sha256}


@app.get("/api/assignments/{assignment_id}/download")
def download_assignment(assignment_id: uuid.UUID, request: Request, user: User = Depends(current_user), db: Session = Depends(db_session)):
    assignment = db.get(Assignment, assignment_id)
    if not assignment or (user.role == "signer" and assignment.signer_id != user.id):
        audit(db, user, "document.download.denied", request, assignment.document_id if assignment else None, "reason=not_found_or_unauthorized", status="FAILED")
        db.commit()
        raise HTTPException(404, "Documento no disponible")
    document = db.get(Document, assignment.document_id)
    if document.deleted_at:
        audit(db, user, "document.download.denied", request, document.id, "reason=document_deleted", status="FAILED")
        db.commit()
        raise HTTPException(404, "Documento no disponible")
    path = assignment.signed_path if assignment.status == "signed" else document.stored_path
    if not path or not Path(path).is_file():
        audit(db, user, "document.download.denied", request, document.id, "reason=file_missing_on_disk", status="FAILED")
        db.commit()
        raise HTTPException(404, "Archivo no disponible")
    source_ip = request.client.host if request.client else "unknown"
    assignment.received_at = datetime.now(timezone.utc)
    assignment.received_from_ip = source_ip
    assignment.last_downloaded_at = datetime.now(timezone.utc)
    assignment.last_downloaded_ip = source_ip
    audit(db, user, "document.downloaded", request, document.id, f"file={document.original_name};size_bytes={document.size_bytes};ip={source_ip}")
    db.commit()
    return FileResponse(path, filename=document.original_name, media_type="application/pdf")


@app.delete("/api/documents/{document_id}")
@limiter.limit("20/minute")
def delete_document(document_id: uuid.UUID, request: Request, _csrf=Depends(require_csrf), admin: User = Depends(require_role("admin")), db: Session = Depends(db_session)):
    document = db.get(Document, document_id)
    if not document or document.deleted_at:
        audit(db, admin, "document.deleted", request, document_id, "reason=not_found", status="FAILED")
        db.commit()
        raise HTTPException(404, "Documento no encontrado")
    # Borrado lógico: el registro y su rastro de auditoría se conservan siempre;
    # solo se elimina el contenido binario del disco (original + una copia firmada
    # por cada firmante, ya que con "enviar en masa" puede haber varias).
    for stored in (document.stored_path, document.signed_path):
        if stored and Path(stored).is_file():
            Path(stored).unlink(missing_ok=True)
    for assignment in db.scalars(select(Assignment).where(Assignment.document_id == document.id)):
        if assignment.signed_path and Path(assignment.signed_path).is_file():
            Path(assignment.signed_path).unlink(missing_ok=True)
    document.deleted_at = datetime.now(timezone.utc)
    document.deleted_by = admin.id
    audit(db, admin, "document.deleted", request, document.id, f"filename={document.original_name};sha256={document.sha256}")
    db.commit()
    return {"ok": True}


@app.post("/api/direct/sign")
@limiter.limit("20/minute")
async def direct_sign(payload: DirectSignRequest, request: Request, _csrf=Depends(require_csrf), user: User = Depends(require_role("admin", "signer")), db: Session = Depends(db_session)):
    """
    Firma "directa" (sin flujo de asignación): el documento no se guarda en el
    servidor, solo se reenvía a SignServer y se devuelve el resultado. Existe para
    que la funcionalidad de firma directa del panel quede, igual que todo lo demás,
    registrada en la bitácora de auditoría.
    """
    if payload.worker not in DIRECT_SIGN_WORKERS:
        raise HTTPException(400, "Worker no reconocido")
    try:
        raw = base64.b64decode(payload.data, validate=True)
    except Exception as exc:
        raise HTTPException(400, "El campo 'data' no es base64 válido") from exc
    original_sha256 = hashlib.sha256(raw).hexdigest()

    async with httpx.AsyncClient(timeout=120, verify=False) as client:
        response = await client.post(
            f"{SIGN_SERVER_URL}/rest/v1/workers/{payload.worker}/process",
            json={"data": payload.data, "encoding": "BASE64"},
        )

    if response.status_code >= 400:
        error_body = response.text[:500]
        lowered = error_body.lower()
        if "expired" in lowered or "not yet valid" in lowered or "vencid" in lowered:
            event = "certificate.expired"
        elif "revoked" in lowered or "revocad" in lowered:
            event = "worker.revoked"
        else:
            event = "document.sign.failed"
        audit(db, user, event, request, details=f"modo=directo;worker={payload.worker};filename={payload.filename};sha256={original_sha256};http_status={response.status_code};error={error_body}", status="FAILED")
        db.commit()
        raise HTTPException(502, "SignServer no pudo firmar el documento")

    signed_b64 = response.json()["data"]
    signed_sha256 = hashlib.sha256(base64.b64decode(signed_b64, validate=True)).hexdigest()
    audit(db, user, "document.signed", request, details=f"modo=directo;worker={payload.worker};filename={payload.filename};sha256_original={original_sha256};sha256_firmado={signed_sha256}")
    db.commit()
    return {
        "data": signed_b64,
        "sha256_original": original_sha256,
        "sha256_firmado": signed_sha256,
    }


@app.post("/api/direct/validate")
@limiter.limit("30/minute")
async def direct_validate(payload: DirectValidateRequest, request: Request, _csrf=Depends(require_csrf), user: User = Depends(current_user), db: Session = Depends(db_session)):
    """Valida un documento a través del servicio de validación, dejando constancia en la bitácora."""
    if payload.format not in DIRECT_VALIDATE_FORMATS:
        raise HTTPException(400, "Formato de validación no reconocido")
    try:
        base64.b64decode(payload.data, validate=True)
    except Exception as exc:
        raise HTTPException(400, "El campo 'data' no es base64 válido") from exc

    async with httpx.AsyncClient(timeout=60, verify=False) as client:
        response = await client.post(
            f"{VALIDATE_SERVICE_URL}/{payload.format}",
            json={"data": payload.data, "filename": payload.filename, "encoding": "BASE64"},
        )

    if response.status_code >= 400:
        error_body = response.text[:500]
        audit(db, user, "document.validated", request, details=f"modo=directo;formato={payload.format};filename={payload.filename};http_status={response.status_code};error={error_body}", status="FAILED")
        db.commit()
        raise HTTPException(response.status_code if response.status_code < 500 else 502, error_body or "El servicio de validación no respondió correctamente")

    result = response.json()
    audit(
        db, user, "document.validated", request,
        details=f"modo=directo;formato={payload.format};filename={payload.filename};resultado={'valido' if result.get('valid') else 'invalido'};resumen={result.get('summary','')}",
    )
    db.commit()
    return result


@app.post("/api/audit/client-event")
@limiter.limit("60/minute")
def client_audit_event(payload: ClientAuditEventRequest, request: Request, _csrf=Depends(require_csrf), user: User = Depends(current_user), db: Session = Depends(db_session)):
    """
    Permite que acciones puramente del navegador (p. ej. diseñar/descargar un PDF con
    jsPDF, que nunca toca el servidor) queden igualmente registradas en la bitácora.
    Restringido a una lista blanca de acciones para que no se pueda usar para
    inyectar entradas arbitrarias.
    """
    if payload.action not in ALLOWED_CLIENT_ACTIONS:
        raise HTTPException(400, "Acción no permitida")
    audit(db, user, payload.action, request, details=payload.details[:500])
    db.commit()
    return {"ok": True}


@app.get("/api/audit")
def audit_log(user: User = Depends(require_role("admin", "auditor")), db: Session = Depends(db_session)):
    rows = db.scalars(select(AuditEvent).order_by(AuditEvent.created_at.desc()).limit(500)).all()
    return [
        {
            "id": str(row.id),
            "actor_id": str(row.actor_id) if row.actor_id else None,
            "actor_email": row.actor_email,
            "action": row.action,
            "status": row.status,
            "client": row.client,
            "user_agent": row.user_agent,
            "document_id": str(row.document_id) if row.document_id else None,
            "ip": row.ip_address,
            "details": row.details,
            "created_at": row.created_at.isoformat(),
        }
        for row in rows
    ]


@app.get("/api/audit/verify")
def audit_verify(user: User = Depends(require_role("admin", "auditor")), db: Session = Depends(db_session)):
    """
    Recorre la bitácora en orden cronológico y recalcula el hash de cada evento a
    partir del hash del evento anterior. Si algún registro fue editado o eliminado
    directamente en la base de datos (evitando la API), la cadena se rompe en ese
    punto y queda expuesto — es el mecanismo de "tamper-evidence" que exigen los
    estándares de auditoría forense.
    """
    rows = db.scalars(select(AuditEvent).order_by(AuditEvent.created_at.asc(), AuditEvent.id.asc())).all()
    expected_prev = GENESIS_HASH
    broken_at: str | None = None
    checked = 0
    for row in rows:
        if row.event_hash is None:
            # Evento histórico anterior a la implementación del hash-chain; no participa en la verificación.
            continue
        checked += 1
        recomputed = compute_event_hash(
            expected_prev, row.actor_id, row.actor_email, row.action, row.document_id,
            row.status, row.ip_address, row.details, row.user_agent, row.created_at,
        )
        if row.prev_hash != expected_prev or recomputed != row.event_hash:
            broken_at = str(row.id)
            break
        expected_prev = row.event_hash
    return {"valid": broken_at is None, "events_checked": checked, "broken_at_event_id": broken_at}