#!/bin/bash
# ===========================================
# ArquiVision AI - Google Cloud Run Deployment
# ===========================================
set -e

PROJECT_ID="gen-lang-client-0947004571"
REGION="europe-west1"

# SECURITY: API key is NEVER hardcoded. Read from environment.
GEMINI_API_KEY="${GEMINI_API_KEY:?ERROR: Set GEMINI_API_KEY env var before deploying}"
SUPABASE_URL="https://axprxywbbrrlypfaycpb.supabase.co"
SUPABASE_ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF4cHJ4eXdiYnJybHlwZmF5Y3BiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjkxNjEzODksImV4cCI6MjA4NDczNzM4OX0.0iIydaM-iFcabn-q63dqK_1CTLX8LRW_mGOr8qT0pZ0"

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

BACKEND_URL=$(gcloud run deploy archivision-backend \
  --source . \
  --project "$PROJECT_ID" \
  --region "$REGION" \
  --allow-unauthenticated \
  --set-env-vars="GEMINI_API_KEY=$GEMINI_API_KEY,SUPABASE_URL=$SUPABASE_URL,SUPABASE_ANON_KEY=$SUPABASE_ANON_KEY" \
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
