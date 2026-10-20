FROM python:3.12-bookworm

# poppler-utils   -> pdfsig            (PDF)
# openjdk-17-jre  -> jarsigner         (JAR)
# openssl         -> openssl cms       (CMS/.p7s)
# dpkg-sig, gnupg, binutils (ar) -> validación/ fallback de Debian (.deb)
# xmlsec1         -> xmlsec1 --verify  (XML)
RUN apt-get update && apt-get install -y --no-install-recommends \
    poppler-utils \
    openjdk-17-jre-headless \
    openssl \
    gnupg \
    binutils \
    xmlsec1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY main.py .

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
