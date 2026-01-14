@echo off
REM TalkBridge Backend Deployment Script for Google Cloud Run (Windows)

echo 🚀 Starting deployment to Google Cloud Run...

REM Configuration
set PROJECT_ID=youtube-extension-1767318864
set SERVICE_NAME=talkbridge-backend
set REGION=us-central1
set IMAGE_NAME=gcr.io/%PROJECT_ID%/%SERVICE_NAME%

REM Check if gcloud is installed
where gcloud >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ❌ gcloud CLI is not installed. Please install it first:
    echo    https://cloud.google.com/sdk/docs/install
    exit /b 1
)

REM Set project
echo 🔧 Setting project to %PROJECT_ID%...
gcloud config set project %PROJECT_ID%

REM Build the container image
echo 🔨 Building Docker image...
gcloud builds submit --tag %IMAGE_NAME%

if %ERRORLEVEL% NEQ 0 (
    echo ❌ Build failed!
    exit /b 1
)

REM Deploy to Cloud Run
echo 🚀 Deploying to Cloud Run...
gcloud run deploy %SERVICE_NAME% ^
  --image %IMAGE_NAME% ^
  --platform managed ^
  --region %REGION% ^
  --allow-unauthenticated ^
  --port 8080 ^
  --memory 512Mi ^
  --cpu 1 ^
  --min-instances 0 ^
  --max-instances 10

if %ERRORLEVEL% EQU 0 (
    echo ✅ Deployment successful!
    echo.
    echo 🌐 Service URL:
    gcloud run services describe %SERVICE_NAME% --region %REGION% --format "value(status.url)"
) else (
    echo ❌ Deployment failed!
    exit /b 1
)
