#!/usr/bin/env bash
# Deploy cryptosignal copilot to Google Cloud Run (asia-southeast1).
# Prerequisites: gcloud auth, Artifact Registry repo, Secret Manager secrets.
set -euo pipefail

REGION="${REGION:-asia-southeast1}"
PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}"
SERVICE="${SERVICE:-cryptosignal-copilot}"
IMAGE="${IMAGE:-${REGION}-docker.pkg.dev/${PROJECT_ID}/cryptosignal/${SERVICE}:latest}"

if [[ -z "${PROJECT_ID}" ]]; then
  echo "Set PROJECT_ID or configure gcloud default project." >&2
  exit 1
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
docker build -t "${IMAGE}" "${ROOT}/apps/copilot"
docker push "${IMAGE}"

gcloud run deploy "${SERVICE}" \
  --image "${IMAGE}" \
  --region "${REGION}" \
  --platform managed \
  --allow-unauthenticated \
  --min-instances 0 \
  --timeout 600 \
  --port 8080 \
  --set-env-vars "PORT=8080,COPILOT_RUN_DB_MIGRATIONS=true,LLM_API_STYLE=openai" \
  --set-secrets "LLM_API_KEY=LLM_API_KEY:latest,LLM_BASE_URL=LLM_BASE_URL:latest,LLM_MODEL=LLM_MODEL:latest,DATABASE_URL=DATABASE_URL:latest,CORS_ORIGINS=CORS_ORIGINS:latest"

echo "Deployed ${SERVICE} in ${REGION}"
