# TalkBridge Backend Deployment Guide

## Prerequisites

1. **Google Cloud SDK** installed and configured
   - Download: https://cloud.google.com/sdk/docs/install
   - After installing, run: `gcloud init`

2. **Docker** (optional, GCP will build for you)

3. **Authenticate with Google Cloud**
   ```bash
   gcloud auth login
   gcloud config set project talkbridge-backend
   ```

## Quick Deployment (Recommended)

### On Windows:
```bash
cd backend
deploy.bat
```

### On Mac/Linux:
```bash
cd backend
chmod +x deploy.sh
./deploy.sh
```

## Manual Deployment

If you prefer to deploy manually:

### 1. Set your project
```bash
gcloud config set project talkbridge-backend
```

### 2. Build the container
```bash
gcloud builds submit --tag gcr.io/talkbridge-backend/talkbridge-backend
```

### 3. Deploy to Cloud Run
```bash
gcloud run deploy talkbridge-backend \
  --image gcr.io/talkbridge-backend/talkbridge-backend \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --port 8080 \
  --memory 512Mi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 10
```

## Environment Variables

If you need to set environment variables (API keys, etc.):

```bash
gcloud run services update talkbridge-backend \
  --region us-central1 \
  --set-env-vars "GOOGLE_API_KEY=your-key-here,NODE_ENV=production"
```

Or set them in the Google Cloud Console:
1. Go to Cloud Run console
2. Select your service
3. Click "Edit & Deploy New Revision"
4. Go to "Variables & Secrets" tab
5. Add your environment variables

## Verify Deployment

After deployment, test the endpoints:

```bash
# Health check
curl https://talkbridge-backend-1053199504066.us-central1.run.app/health

# Trial stats
curl https://talkbridge-backend-1053199504066.us-central1.run.app/api/trial/stats
```

## View Logs

```bash
gcloud run services logs read talkbridge-backend --region us-central1 --limit 50
```

Or view in the console: https://console.cloud.google.com/run

## Rollback

If you need to rollback to a previous version:

```bash
gcloud run services update-traffic talkbridge-backend \
  --region us-central1 \
  --to-revisions REVISION-NAME=100
```

## Cost Optimization

Current settings:
- **min-instances: 0** - Scales to zero when not in use (saves money)
- **max-instances: 10** - Limits maximum concurrent instances
- **memory: 512Mi** - Should be sufficient for this API
- **cpu: 1** - 1 vCPU allocated

You're only charged for:
- Request time (billed per 100ms)
- Memory allocation during requests
- Container image storage

## Troubleshooting

### Build fails
- Check that all files are present
- Verify package.json is valid
- Check Docker file syntax

### Deployment fails
- Verify you have permissions in the GCP project
- Check that the service name is correct
- Ensure the region is correct

### Service errors
- View logs: `gcloud run services logs read talkbridge-backend --region us-central1`
- Check environment variables are set correctly
- Verify the PORT environment variable (Cloud Run sets this automatically)

## What's New in This Deployment

This deployment includes:
- ✅ New `/api/trial/start` endpoint for email verification
- ✅ New `/api/trial/validate` endpoint for trial validation
- ✅ New `/api/trial/stats` endpoint for admin statistics
- ✅ Browser fingerprinting support
- ✅ Email and device duplicate detection
- ✅ File-based storage for trials (will create `data/trials.json`)

## Data Persistence

The backend stores data in JSON files:
- `data/waitlist.json` - Waitlist registrations
- `data/trials.json` - Trial registrations (NEW)

**Note**: Cloud Run is stateless, so files written to disk will be lost when the container restarts. For production, consider:
- Using Cloud Storage for file persistence
- Using Cloud Firestore or Cloud SQL for database
- Or continue with file storage (acceptable for MVP)
