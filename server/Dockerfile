# Unsattai API (FastAPI + SQLite). Build context: server/
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /srv/api
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY app ./app
# The database lives on a volume so it survives rebuilds and upgrades.
ENV DB_PATH=/data/unsattai.db
RUN useradd --system --uid 10001 unsattai && mkdir -p /data && chown unsattai /data
USER unsattai
# PORT is set by hosting platforms such as Render or Railway; 8000 otherwise.
ENV PORT=8000
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD python -c "import os,urllib.request,sys; sys.exit(0 if urllib.request.urlopen(f'http://127.0.0.1:{os.environ[\"PORT\"]}/api/v1/health', timeout=4).status == 200 else 1)"
# One process: SQLite is written by a single server. Tables are created and upgraded on start.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port \"$PORT\" --proxy-headers --forwarded-allow-ips '*'"]
