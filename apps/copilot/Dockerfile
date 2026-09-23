# Render free-tier / any Docker host. Binds 0.0.0.0:$PORT (Render injects PORT).
FROM python:3.12-slim

WORKDIR /app

COPY pyproject.toml ./
COPY src ./src

RUN pip install --no-cache-dir --upgrade pip \
  && pip install --no-cache-dir .

# Do not bake secrets. Set LLM_* / CORS_ORIGINS on the host (Render dashboard).
ENV PORT=8000
EXPOSE 8000

# Shell form so $PORT expands at runtime.
CMD ["sh", "-c", "uvicorn cryptosignal_copilot.app:app --host 0.0.0.0 --port ${PORT:-8000}"]
