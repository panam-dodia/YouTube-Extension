# TalkBridge - Universal Video Translator & Q&A Extension

Chrome extension for real-time video translation with AI voice dubbing and intelligent Q&A. **Now works with ANY video on ANY website, not just YouTube!**

## Features

- **Universal Video Support** - Works with YouTube, Vimeo, social media videos, and any HTML5 video on the web
- **Live Audio Translation** - Real-time speech-to-text transcription and translation for videos without captions
- **Smart Fallback** - Uses YouTube transcripts when available for faster, more accurate results
- **AI Voice Dubbing** - Natural-sounding translated audio with synchronized playback
- **Auto Language Detection** - Automatically detects source language and skips translation when source matches target
- **Smart Q&A** - Ask questions about video content or anything beyond
- **Full Transcripts** - Access complete video transcripts in original language
- **No API Keys Required** - Works immediately after installation

## Testing the Extension

### For Testers

1. Download or receive the extension folder from the developer
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** (toggle switch in top right corner)
4. Click **Load unpacked** button
5. Select the `YouTube Extension` folder
6. The TalkBridge extension is now installed

### First Time Setup

1. After installation, a welcome page will open automatically
2. Click the TalkBridge extension icon in your browser toolbar
3. Configure your preferences:
   - Select your target language
   - Enable Translation feature
   - Enable Q&A feature
4. Click **Save Settings**

### Using the Extension

1. Navigate to ANY video on the web (YouTube, Vimeo, Twitter/X, Facebook, news sites, etc.)
2. Look for the floating TalkBridge button on the bottom right of the video page
3. Click the button to open the TalkBridge panel
4. The extension will automatically:
   - Use YouTube transcripts if available (faster, more accurate)
   - Fall back to live audio capture for videos without transcripts
   - Detect the source language automatically
   - Skip translation if source and target languages match (transcription-only mode)
5. Use the three tabs:
   - **Translation** - View translated segments with synchronized audio
   - **Transcript** - Read the full original transcript
   - **Chat** - Ask questions about the video content (YouTube only)

### Controls

- **Play/Pause buttons** - Control translated audio playback
- **Tab switching** - Switch between Translation, Transcript, and Chat
- **Minimize button** - Minimize the panel
- **Close button** - Close the panel

## Tech Stack

**Frontend:**
- Vanilla JavaScript (Chrome Extension APIs)
- Chrome Storage API
- YouTube Transcript API

**Backend:**
- Node.js + Express
- Deployed on Google Cloud Run
- Google Gemini AI (Translation & Q&A)
- Google Cloud Text-to-Speech (Voice Dubbing)
- Google Cloud Speech-to-Text (Live Audio Transcription)

**Architecture:**
- Extension URL: `https://talkbridge-backend-1053199504066.us-central1.run.app`
- Dual-mode operation: Transcript-based (YouTube) + Live audio capture (Universal)
- Real-time speech recognition and translation
- Synchronized audio playback
- AI-powered question answering
- Automatic language detection

## File Structure

```
YouTube Extension/
├── manifest.json              # Extension configuration (now supports all URLs)
├── popup/                     # Extension settings popup
│   ├── popup.html
│   ├── popup.css
│   └── popup.js
├── content/                   # Content scripts (runs on ALL websites)
│   ├── audio-capture.js       # NEW: Live audio capture manager
│   ├── content-autoplay.js    # Updated: Dual-mode translation
│   └── content-startup.css
├── background/                # Background service worker
│   └── background.js
├── backend/                   # Backend API
│   ├── server.js
│   ├── services/
│   │   ├── gemini.service.js  # Translation & Q&A
│   │   ├── tts.service.js     # Text-to-Speech
│   │   └── stt.service.js     # NEW: Speech-to-Text
│   └── routes/
│       └── translation.routes.js  # Updated: Added STT endpoints
├── welcome/                   # Welcome page (first install)
│   ├── welcome.html
│   ├── welcome.css
│   └── welcome.js
├── assets/                    # Extension icons
└── README.md
```

## How It Works

### Transcript Mode (YouTube with captions)
1. Content script detects YouTube video with available captions
2. Fetches video transcript using YouTube's Innertube API
3. Sends transcript segments to backend for translation on-demand (real-time)
4. Generates audio for each translated segment
5. Displays translations in synchronized panel
6. Enables Q&A chat with AI about video content

### Live Audio Mode (Any video without captions)
1. Content script detects any HTML5 video element
2. Captures live audio stream from video using Web Audio API
3. Sends 3-second audio chunks to backend for speech-to-text transcription
4. Auto-detects source language from audio
5. Translates transcribed text to target language (or skips if languages match)
6. Generates and plays translated audio in real-time
7. Displays live transcriptions/translations as they appear

## Requirements

- Active internet connection for translation, transcription, and Q&A
- Chrome browser (or Chromium-based browsers)
- Microphone permission (auto-requested for live audio capture mode)
- For best results: Clear audio in videos without background noise

## Supported Languages

**Translation & Text-to-Speech:**
- English
- Spanish
- French
- German
- Italian
- Portuguese
- Russian
- Japanese
- Korean
- Chinese
- Hindi

**Speech-to-Text (Live Audio Mode):**
- English (US)
- Hindi (India)
- Spanish (Spain)
- French (France)
- German (Germany)
- Japanese (Japan)
- Portuguese (Brazil)
- Chinese (Mandarin)
- Korean (South Korea)
- Italian (Italy)
- Russian (Russia)
- Arabic (Saudi Arabia)
- Turkish (Turkey)
- Dutch (Netherlands)
- Polish (Poland)

## Privacy & Data

- No personal data collection
- Video transcripts processed anonymously
- All processing happens through secure backend API
- No user tracking or analytics

## Known Limitations

**General:**
- Audio playback requires stable internet connection
- Live audio mode requires decent audio quality for accurate transcription
- Background noise can affect transcription accuracy

**Transcript Mode (YouTube):**
- Faster and more accurate when captions are available
- Falls back to live audio mode if no captions

**Live Audio Mode (Universal):**
- Real-time processing may have 1-3 second latency
- Works best with clear speech and minimal background noise
- Audio capture uses more bandwidth than transcript mode

## Troubleshooting

**Extension not appearing:**
- Ensure Developer mode is enabled
- Try reloading the extension from chrome://extensions/
- Make sure you're on a page with a video element

**Translation not working:**
- Check browser console for any errors
- Ensure your internet connection is stable
- For YouTube: Extension will auto-switch between transcript and live audio mode
- For other sites: Make sure video is playing (audio capture needs active audio)

**Audio not playing:**
- Ensure video audio is playing in the browser
- Check your internet connection
- Try refreshing the page
- Check browser console for API errors

**Live audio mode issues:**
- Grant microphone/audio capture permissions when prompted
- Ensure video has clear audio (not muted)
- Background music or noise may affect transcription quality
- Try adjusting video volume

**Permission errors:**
- If you see "Audio capture failed", reload the extension
- Grant tabCapture permission when Chrome requests it
- Check chrome://extensions/ to ensure all permissions are granted

## Backend Setup (For Developers)

To deploy the backend with Speech-to-Text support:

1. Install dependencies:
```bash
cd backend
npm install
```

2. Set up Google Cloud credentials:
   - Enable Google Cloud Speech-to-Text API in your GCP project
   - Enable Google Cloud Text-to-Speech API
   - Download service account key JSON
   - Set `GOOGLE_APPLICATION_CREDENTIALS` environment variable

3. Configure environment variables in `.env`:
```
PORT=8080
GEMINI_API_KEY=your_gemini_api_key
GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account-key.json
```

4. Deploy to Google Cloud Run or run locally:
```bash
npm start
```

## Free Trial System

TalkBridge offers a 7-day free trial for new users with the following terms:

### Trial Duration
- Trial period: 7 calendar days from registration
- Daily usage limit: 15 minutes of translation per day

### How Trial Time is Calculated
- The trial counts elapsed calendar days, NOT usage days
- The countdown starts from the moment you register and continues regardless of actual usage
- Example: If you register on January 1st and don't use the extension until January 5th, you will have only 2 days remaining

### Trial Behavior
| Scenario | Effect on Trial |
|----------|-----------------|
| Not using the product | Trial continues counting down |
| Disabling the extension | Trial continues counting down |
| Closing the browser | Trial continues counting down |
| Uninstalling extension | Local data cleared, but backend blocks same email/device from re-registering |

### Trial Data Storage
- Backend stores: email, device fingerprint, start timestamp, and status
- Client stores: email, install date, device fingerprint, and daily usage
- Trial validation happens both client-side and server-side

### After Trial Expires
- Users are prompted to join the waitlist for future access
- Settings and translation features become unavailable
- Previously saved settings are preserved for when access is restored

## What's New in v2.0

**Universal Video Support**
- Works on ANY website with HTML5 video, not just YouTube
- Automatic video detection across all web pages

**Live Audio Transcription**
- Real-time speech-to-text for videos without captions
- Powered by Google Cloud Speech-to-Text
- 3-second audio chunks for low latency

**Smart Language Detection**
- Automatic source language detection
- Skips translation when source matches target (transcription-only mode)
- 15+ languages supported for speech recognition

**Real-Time Processing**
- YouTube transcripts processed on-demand (no upfront wait)
- Live audio translated as you watch
- Instant feedback in UI

**Enhanced Permissions**
- `tabCapture` permission for audio capture
- Works on all URLs (not just YouTube)

## Future Enhancements

- Dual subtitles (original + translation overlay on video)
- Custom voice selection (pitch, speed, etc.)
- Download translated transcripts as SRT files
- Offline mode with cached translations
- WebSocket streaming for even lower latency
- Multi-speaker detection and voice matching

## Support

For issues, feedback, or questions:
- Check browser console for error messages
- Ensure backend API is accessible
- Verify extension has proper permissions

## License

MIT License - Free to use and modify

---

**TalkBridge v2.0.0** - Universal Video Translation Extension

**Major Changes:**
- Universal video support (all websites)
- Live audio transcription (Google Cloud Speech-to-Text)
- Dual-mode operation (Transcript + Live Audio)
- Auto language detection
- Real-time on-demand translation
- 7-day free trial with daily usage limits
