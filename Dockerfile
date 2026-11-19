FROM python:3.12-bookworm

# Build the validator from the repository's current service directory.
ARG SIGNSERVER_REPOSITORY=https://github.com/ElAlecs69/SignServer.git

# poppler-utils   -> pdfsig            (PDF)
# openjdk-17-jre  -> jarsigner         (JAR)
# openssl         -> openssl cms       (CMS/.p7s)
# gnupg, binutils (ar) -> validación fallback de Debian (.deb)
# xmlsec1         -> xmlsec1 --verify  (XML)
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    poppler-utils \
    openjdk-17-jre-headless \
    openssl \
    gnupg \
    binutils \
    xmlsec1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN git clone --depth 1 "${SIGNSERVER_REPOSITORY}" /app/SignServer

WORKDIR /app/SignServer/Archivos/services/validate-service
RUN pip install --no-cache-dir -r requirements.txt

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
