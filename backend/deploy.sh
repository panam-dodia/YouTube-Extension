#!/bin/bash

# TalkBridge Backend Deployment Script for Google Cloud Run

echo "🚀 Starting deployment to Google Cloud Run..."

# Configuration
PROJECT_ID="talkbridge-backend"
SERVICE_NAME="talkbridge-backend"
REGION="us-central1"
IMAGE_NAME="gcr.io/${PROJECT_ID}/${SERVICE_NAME}"

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo "❌ gcloud CLI is not installed. Please install it first:"
    echo "   https://cloud.google.com/sdk/docs/install"
    exit 1
fi

# Check if logged in
echo "📋 Checking Google Cloud authentication..."
if ! gcloud auth list --filter=status:ACTIVE --format="value(account)" | grep -q .; then
    echo "❌ Not logged in to Google Cloud. Running 'gcloud auth login'..."
    gcloud auth login
fi

# Set project
echo "🔧 Setting project to ${PROJECT_ID}..."
gcloud config set project ${PROJECT_ID}

# Build the container image
echo "🔨 Building Docker image..."
gcloud builds submit --tag ${IMAGE_NAME}

if [ $? -ne 0 ]; then
    echo "❌ Build failed!"
    exit 1
fi

# Deploy to Cloud Run
echo "🚀 Deploying to Cloud Run..."
gcloud run deploy ${SERVICE_NAME} \
  --image ${IMAGE_NAME} \
  --platform managed \
  --region ${REGION} \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 10

if [ $? -eq 0 ]; then
    echo "✅ Deployment successful!"
    echo ""
    echo "🌐 Service URL:"
    gcloud run services describe ${SERVICE_NAME} --region ${REGION} --format 'value(status.url)'
else
    echo "❌ Deployment failed!"
    exit 1
fi
