# YouTube Extension Backend

Backend API server for the YouTube Translation Extension.

## Features

- **Translation**: Translate text using Google Gemini AI
- **Text-to-Speech**: Convert translated text to speech using ElevenLabs
- **Q&A**: Answer questions about video content using AI
- **Gender Detection**: Detect speaker gender for voice matching

## Setup

### 1. Install Dependencies

```bash
cd backend
npm install
```

### 2. Configure Environment Variables

Create a `.env` file:

```bash
cp .env.example .env
```

Edit `.env` and add your API keys:

```
GEMINI_API_KEY=your_gemini_api_key_here
ELEVENLABS_API_KEY=your_elevenlabs_api_key_here
PORT=8080
NODE_ENV=development
```

### 3. Get API Keys

#### Gemini API Key
1. Go to [Google AI Studio](https://makersuite.google.com/app/apikey)
2. Create a new API key
3. Copy and paste into `.env`

#### ElevenLabs API Key
1. Go to [ElevenLabs](https://elevenlabs.io/)
2. Sign up for an account
3. Go to Profile → API Keys
4. Create a new API key
5. Copy and paste into `.env`

### 4. Run the Server

Development mode (with auto-reload):
```bash
npm run dev
```

Production mode:
```bash
npm start
```

Server will start on `http://localhost:8080`

## API Endpoints

### Health Check
```
GET /health
```

### Translate Text
```
POST /api/translation/translate
Body: {
  "text": "Hello, how are you?",
  "targetLanguage": "Spanish"
}
```

### Text to Speech
```
POST /api/translation/text-to-speech
Body: {
  "text": "Hola, ¿cómo estás?",
  "gender": "male",
  "language": "Spanish"
}
Response: Audio file (audio/mpeg)
```

### Q&A
```
POST /api/translation/qa
Body: {
  "question": "What is this video about?",
  "transcript": "Video transcript text or array of segments",
  "targetLanguage": "English"
}
```

### Detect Gender
```
POST /api/translation/detect-gender
Body: {
  "transcriptSample": "First few sentences of transcript"
}
```

## Deployment

### Deploy to Cloud Run (Google Cloud)

1. Install Google Cloud CLI
2. Build and deploy:

```bash
gcloud run deploy youtube-extension-backend \
  --source . \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated
```

3. Set environment variables in Cloud Run console

### Deploy to Railway

1. Connect your GitHub repo to Railway
2. Add environment variables
3. Deploy automatically

### Deploy to Vercel

1. Install Vercel CLI: `npm i -g vercel`
2. Run: `vercel`
3. Follow prompts
4. Add environment variables in Vercel dashboard

## Project Structure

```
backend/
├── server.js              # Main server file
├── routes/
│   └── translation.routes.js  # API routes
├── services/
│   ├── gemini.service.js      # Gemini AI service
│   └── tts.service.js         # ElevenLabs TTS service
├── package.json
├── .env.example
└── README.md
```

## Technologies

- **Node.js** - Runtime
- **Express** - Web framework
- **Google Gemini** - AI for translation and Q&A
- **ElevenLabs** - Text-to-speech
- **CORS** - Cross-origin resource sharing

## License

MIT
