#!/bin/bash
# ===========================================
# ArquiVision AI - Google Cloud Run Deployment
# ===========================================
set -e

PROJECT_ID="gen-lang-client-0947004571"
REGION="europe-west1"

# SECURITY: API keys are NEVER hardcoded.
# GEMINI_API_KEY now lives in Secret Manager (secret: gemini-api-key) and is
# injected via --set-secrets below — no longer read from the shell environment.
OPENAI_API_KEY="${OPENAI_API_KEY:?ERROR: Set OPENAI_API_KEY env var before deploying (Phase 1 swap to gpt-image-2)}"
OPENAI_IMAGE_MODEL="${OPENAI_IMAGE_MODEL:-gpt-image-2}"
OPENAI_IMAGE_TIMEOUT_S="${OPENAI_IMAGE_TIMEOUT_S:-180}"
DAILY_USER_CAP_USD="${DAILY_USER_CAP_USD:-25.0}"

SUPABASE_URL="https://axprxywbbrrlypfaycpb.supabase.co"
SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF4cHJ4eXdiYnJybHlwZmF5Y3BiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkxNjEzODksImV4cCI6MjA4NDczNzM4OX0.0iIydaM-iFcabn-q63dqK_1CTLX8LRW_mGOr8qT0pZ0"

# CORS allowlist for the backend. MUST include all production frontend URLs.
# Phase 0 introduced strict CORS — if this is missing, the backend defaults to
# localhost only and prod returns "fail to fetch".
ALLOWED_ORIGINS="${ALLOWED_ORIGINS:-https://bednrixvision.ai,https://archivision-frontend-d4v7u54w5a-ew.a.run.app,https://archivision-frontend-164156113562.europe-west1.run.app}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "========================================="
echo "  ArquiVision AI - Cloud Run Deployment"
echo "========================================="
echo ""

# Step 1: Set GCP project
echo "📌 Setting GCP project to $PROJECT_ID..."
gcloud config set project "$PROJECT_ID"

# Step 2: Enable required APIs
echo "🔧 Enabling Cloud Run and Cloud Build APIs..."
gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com --quiet

# Step 3: Deploy Backend
echo ""
echo "🚀 Step 1/2: Deploying Backend..."
echo "   (This may take 2-5 minutes on first deploy)"
cd "$SCRIPT_DIR/backend"

# NOTE: --set-env-vars with values containing commas must use ^@^ as the
# delimiter (gcloud convention). Without this ALLOWED_ORIGINS breaks parsing.
BACKEND_URL=$(gcloud run deploy archivision-backend \
  --source . \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --allow-unauthenticated \
  "--set-env-vars=^@^OPENAI_API_KEY=$OPENAI_API_KEY@OPENAI_IMAGE_MODEL=$OPENAI_IMAGE_MODEL@OPENAI_IMAGE_TIMEOUT_S=$OPENAI_IMAGE_TIMEOUT_S@DAILY_USER_CAP_USD=$DAILY_USER_CAP_USD@ALLOWED_ORIGINS=$ALLOWED_ORIGINS@SUPABASE_URL=$SUPABASE_URL@SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY" \
  --set-secrets=GEMINI_API_KEY=gemini-api-key:latest \
  --timeout=300 \
  --memory=512Mi \
  --quiet \
  --format='value(status.url)' 2>&1 | tail -1)

# Extract URL from output if format flag doesn't work
if [[ ! "$BACKEND_URL" == http* ]]; then
  BACKEND_URL=$(gcloud run services describe archivision-backend \
    --project "$PROJECT_ID" \
    --region "$REGION" \
    --format='value(status.url)')
fi

echo "✅ Backend deployed at: $BACKEND_URL"
echo ""

# Step 4: Deploy Frontend
echo "🚀 Step 2/2: Deploying Frontend..."
echo "   (This may take 3-7 minutes on first deploy)"
cd "$SCRIPT_DIR"

# SECURITY: Frontend does NOT receive the GEMINI_API_KEY.
# Only public VITE_ variables are passed as build args.
gcloud run deploy archivision-frontend \
  --source . \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --allow-unauthenticated \
  --set-build-env-vars="VITE_SUPABASE_URL=$SUPABASE_URL,VITE_SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY,VITE_BACKEND_URL=$BACKEND_URL" \
  --memory=256Mi \
  --quiet

# Force 100% of traffic to the latest revision. Cloud Run sometimes keeps
# traffic on the previous revision if the new one came up after a delay.
echo "🚦 Forcing 100% traffic to latest frontend revision..."
gcloud run services update-traffic archivision-frontend \
  --to-latest \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --quiet >/dev/null

echo "🚦 Forcing 100% traffic to latest backend revision..."
gcloud run services update-traffic archivision-backend \
  --to-latest \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --quiet >/dev/null

FRONTEND_URL=$(gcloud run services describe archivision-frontend \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --format='value(status.url)')

echo ""
echo "========================================="
echo "  ✅ DEPLOYMENT COMPLETE!"
echo "========================================="
echo ""
echo "  🌐 Frontend: $FRONTEND_URL"
echo "  🔧 Backend:  $BACKEND_URL"
echo "  ❤️  Health:   $BACKEND_URL/api/health"
echo ""
echo "  Try it: open $FRONTEND_URL"
echo "========================================="
