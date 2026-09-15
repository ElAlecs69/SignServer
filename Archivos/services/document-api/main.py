import base64
import hashlib
import os
import secrets
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated

import clamd
import httpx
from authlib.integrations.starlette_client import OAuth
from fastapi import Depends, FastAPI, File, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse, RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address
from pydantic import BaseModel
from sqlalchemy import DateTime, ForeignKey, String, Text, create_engine, select
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, relationship, sessionmaker
from starlette.middleware.sessions import SessionMiddleware

DATABASE_URL = os.environ["DATABASE_URL"]
APP_PUBLIC_URL = os.getenv("APP_PUBLIC_URL", "").rstrip("/")
DOCUMENTS_DIR = Path(os.getenv("DOCUMENTS_DIR", "/data/documents"))
SIGN_SERVER_URL = os.getenv("SIGN_SERVER_URL", "http://signserver-app:8080/signserver")
SIGN_SERVER_WORKER = os.getenv("SIGN_SERVER_WORKER", "PDFSigner")
CLAMAV_HOST = os.getenv("CLAMAV_HOST", "clamav")
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_BYTES", str(25 * 1024 * 1024)))
SESSION_SECRET = os.environ["SESSION_SECRET"]
OIDC_CLIENT_ID = os.environ["OIDC_CLIENT_ID"]
OIDC_CLIENT_SECRET = os.environ["OIDC_CLIENT_SECRET"]
OIDC_SERVER_METADATA_URL = os.environ["OIDC_SERVER_METADATA_URL"]
OIDC_REDIRECT_URI = os.getenv("OIDC_REDIRECT_URI", "")

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
    uploaded_by: Mapped[uuid.UUID] = mapped_column(ForeignKey("app_users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


class Assignment(Base):
    __tablename__ = "document_assignments"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    document_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("documents.id"), index=True)
    signer_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app_users.id"), index=True)
    status: Mapped[str] = mapped_column(String(32), default="pending")
    assigned_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))
    signed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class AuditEvent(Base):
    __tablename__ = "audit_events"
    id: Mapped[uuid.UUID] = mapped_column(primary_key=True, default=uuid.uuid4)
    actor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("app_users.id"))
    action: Mapped[str] = mapped_column(String(80))
    document_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("documents.id"), nullable=True)
    ip_address: Mapped[str] = mapped_column(String(64))
    details: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc))


Base.metadata.create_all(engine)
app = FastAPI(title="SignServer Document API")
limiter = Limiter(key_func=get_remote_address, default_limits=["120/minute"])
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SessionMiddleware, secret_key=SESSION_SECRET, max_age=900, same_site="lax", https_only=True)
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


def audit(db: Session, actor: User, action: str, request: Request, document_id=None, details=""):
    db.add(AuditEvent(actor_id=actor.id, action=action, document_id=document_id, details=details, ip_address=request.client.host if request.client else "unknown"))


def require_csrf(request: Request):
    token = request.headers.get("X-CSRF-Token")
    if not token or not secrets.compare_digest(token, request.session.get("csrf", "")):
        raise HTTPException(status_code=403, detail="CSRF token invalido")


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/auth/login")
async def login(request: Request):
    redirect_uri = OIDC_REDIRECT_URI or request.url_for("auth_callback")
    return await oauth.entra.authorize_redirect(request, redirect_uri)


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
    db.commit()
    request.session["identity"] = {"sub": sub}
    request.session["csrf"] = secrets.token_urlsafe(32)
    return RedirectResponse("/")


@app.get("/api/csrf")
def csrf(request: Request, user: User = Depends(current_user)):
    request.session.setdefault("csrf", secrets.token_urlsafe(32))
    return {"token": request.session["csrf"]}


@app.post("/auth/logout")
def logout(request: Request, _csrf=Depends(require_csrf)):
    request.session.clear()
    return {"ok": True}


class AssignmentRequest(BaseModel):
    signer_email: str


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
        if scanner.instream(data)["stream"][0] != "OK":
            raise HTTPException(422, "El antivirus rechazo el archivo")
    except clamd.ConnectionError as exc:
        raise HTTPException(503, "El antivirus no esta disponible") from exc
    document_id = uuid.uuid4()
    path = DOCUMENTS_DIR / f"{document_id}.pdf"
    path.write_bytes(data)
    document = Document(id=document_id, original_name=file.filename or "documento.pdf", stored_path=str(path), sha256=hashlib.sha256(data).hexdigest(), uploaded_by=admin.id)
    db.add(document)
    audit(db, admin, "document.uploaded", request, document_id, document.original_name)
    db.commit()
    return {"id": str(document_id), "name": document.original_name, "sha256": document.sha256}


@app.post("/api/documents/{document_id}/assign")
@limiter.limit("30/minute")
def assign_document(document_id: uuid.UUID, payload: AssignmentRequest, request: Request, _csrf=Depends(require_csrf), admin: User = Depends(require_role("admin")), db: Session = Depends(db_session)):
    document = db.get(Document, document_id)
    signer = db.scalar(select(User).where(User.email == payload.signer_email))
    if not document or not signer or signer.role != "signer":
        raise HTTPException(404, "Documento o firmante no encontrado")
    assignment = Assignment(document_id=document.id, signer_id=signer.id)
    db.add(assignment)
    audit(db, admin, "document.assigned", request, document.id, f"signer={signer.email}")
    db.commit()
    return {"assignment_id": str(assignment.id), "status": assignment.status}


@app.get("/api/assignments")
def assignments(user: User = Depends(current_user), db: Session = Depends(db_session)):
    query = select(Assignment, Document).join(Document, Assignment.document_id == Document.id)
    if user.role == "signer":
        query = query.where(Assignment.signer_id == user.id)
    rows = db.execute(query.order_by(Assignment.assigned_at.desc())).all()
    return [{"id": str(a.id), "document_id": str(d.id), "name": d.original_name, "status": a.status, "sha256": d.sha256} for a, d in rows]


@app.post("/api/assignments/{assignment_id}/sign")
@limiter.limit("10/minute")
async def sign_assignment(assignment_id: uuid.UUID, request: Request, _csrf=Depends(require_csrf), user: User = Depends(require_role("signer")), db: Session = Depends(db_session)):
    assignment = db.get(Assignment, assignment_id)
    if not assignment or assignment.signer_id != user.id or assignment.status != "pending":
        raise HTTPException(404, "Asignacion no disponible")
    document = db.get(Document, assignment.document_id)
    data = Path(document.stored_path).read_bytes()
    async with httpx.AsyncClient(timeout=120, verify=False) as client:
        response = await client.post(f"{SIGN_SERVER_URL}/rest/v1/workers/{SIGN_SERVER_WORKER}/process", json={"data": base64.b64encode(data).decode(), "encoding": "BASE64"})
    if response.status_code >= 400:
        raise HTTPException(502, "SignServer no pudo firmar el documento")
    signed = base64.b64decode(response.json()["data"], validate=True)
    signed_path = DOCUMENTS_DIR / f"{document.id}.signed.pdf"
    signed_path.write_bytes(signed)
    document.signed_path = str(signed_path)
    document.signed_sha256 = hashlib.sha256(signed).hexdigest()
    document.status = assignment.status = "signed"
    assignment.signed_at = datetime.now(timezone.utc)
    audit(db, user, "document.signed", request, document.id, f"worker={SIGN_SERVER_WORKER};sha256={document.signed_sha256}")
    db.commit()
    return {"status": "signed", "sha256": document.signed_sha256}


@app.get("/api/assignments/{assignment_id}/download")
def download_assignment(assignment_id: uuid.UUID, user: User = Depends(current_user), db: Session = Depends(db_session)):
    assignment = db.get(Assignment, assignment_id)
    if not assignment or (user.role == "signer" and assignment.signer_id != user.id):
        raise HTTPException(404, "Documento no disponible")
    document = db.get(Document, assignment.document_id)
    path = document.signed_path if assignment.status == "signed" else document.stored_path
    if not path or not Path(path).is_file():
        raise HTTPException(404, "Archivo no disponible")
    return FileResponse(path, filename=document.original_name, media_type="application/pdf")


@app.get("/api/audit")
def audit_log(user: User = Depends(require_role("admin", "auditor")), db: Session = Depends(db_session)):
    rows = db.scalars(select(AuditEvent).order_by(AuditEvent.created_at.desc()).limit(500)).all()
    return [{"id": str(row.id), "actor_id": str(row.actor_id), "action": row.action, "document_id": str(row.document_id) if row.document_id else None, "ip": row.ip_address, "details": row.details, "created_at": row.created_at.isoformat()} for row in rows]
