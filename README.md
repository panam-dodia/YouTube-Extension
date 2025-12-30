# 🌉 TalkBridge - YouTube Translator & Q&A Extension

Chrome extension for real-time YouTube video translation with AI voice dubbing and intelligent Q&A.

## Features

✅ **Real-time Translation** - Translate YouTube subtitles to 11+ languages
✅ **AI Voice Dubbing** - Natural-sounding translated audio using ElevenLabs
✅ **Smart Q&A** - Ask questions about video content using RAG-based AI
✅ **Session History** - Access Q&A across all your watched videos
✅ **No Login Required** - Works immediately after installation

## Installation (Development)

1. Open Chrome and go to `chrome://extensions/`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select the `YouTube Extension` folder
5. The extension icon will appear in your toolbar

## Usage

1. **Go to any YouTube video** with captions/subtitles
2. **Click the TalkBridge icon** in your toolbar
3. **Enable features:**
   - ✅ Enable Translation
   - ✅ Enable Q&A Panel
   - ✅ Enable Voice Dubbing
4. **Select target language** (e.g., Spanish, French, Hindi)
5. **Click "Save Settings"**
6. **Refresh the YouTube page** to activate features

### Using Q&A

- A Q&A panel will appear on the right side of the video
- Type questions like:
  - "What is the main topic of this video?"
  - "Summarize the key points"
  - "What did they say about [topic]?"
- Get instant AI-powered answers based on the video content

## Tech Stack

- **Frontend**: Vanilla JavaScript (Chrome Extension APIs)
- **Backend**: Node.js + Express (Cloud Run)
- **AI**: Google Gemini (RAG Q&A), Vertex AI (Translation)
- **Voice**: ElevenLabs (Text-to-Speech)
- **Storage**: Chrome Storage API, SQLite (backend)

## Backend API

The extension connects to TalkBridge backend:
- **URL**: `https://talkbridge-backend-149462569558.us-central1.run.app`
- **Endpoints**:
  - `POST /api/youtube/sessions` - Create session with transcript
  - `POST /api/youtube/qa` - Ask questions about video

## Development

### File Structure
```
YouTube Extension/
├── manifest.json           # Extension configuration
├── popup/                  # Extension popup UI
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── content/                # Runs on YouTube pages
│   ├── content.js
│   └── content.css
├── background/             # Background service worker
│   └── background.js
├── assets/                 # Icons and images
└── README.md
```

### How It Works

1. **Content Script** (`content.js`) runs on YouTube watch pages
2. Fetches video transcript using YouTube Innertube API
3. Sends transcript to backend for translation and indexing
4. Creates Q&A panel overlay on YouTube page
5. User asks questions → sent to backend RAG system
6. Backend searches transcript and generates AI answers
7. Answers displayed in Q&A panel

## Limitations

- Requires videos to have captions/subtitles enabled
- Translation quality depends on source caption accuracy
- Q&A works best with educational/informational videos

## Privacy

- No personal data collected
- Video transcripts processed anonymously
- User ID generated locally for session management
- All data stored temporarily for Q&A functionality

## Future Features

- [ ] Dual subtitles (original + translation)
- [ ] Custom voice selection for dubbing
- [ ] Export transcript + translations
- [ ] Cross-video search ("Find videos where I learned about X")
- [ ] Offline mode with cached translations

## Support

For issues or questions:
- GitHub: https://github.com/panam-dodia/VoiceBridge
- Backend: https://talkbridge-frontend-149462569558.us-central1.run.app

## License

MIT License - Feel free to use and modify!

---

Made with ❤️ by TalkBridge Team