// TalkBridge - Transcript-Based Translation Only
// Clean version focusing on fetching and translating existing captions/transcripts
console.log('🌉 TalkBridge extension loaded (Transcript-Only Mode)');

const API_URL = 'https://talkbridge-backend-1053199504066.us-central1.run.app';

// State
let settings = {
  targetLanguage: '',
  enableTranslation: false,
  sourceLanguage: 'en'
};
let currentVideoId = null;
let transcript = null;
let translations = new Map();
let audioCache = new Map();
let unifiedPanel = null;
let detectedGender = 'male';
let isTranslationActive = false; // Prevent multiple simultaneous translations

// Initialize extension
async function init() {
  const stored = await chrome.storage.sync.get({
    targetLanguage: '',
    enableTranslation: false,
    sourceLanguage: 'en'
  });
  settings = stored;

  // Detect video pages and auto-start translation
  const detectAndLoadVideo = async () => {
    const video = document.querySelector('video');

    if (video && isYouTubePage()) {
      const videoId = extractYouTubeVideoId();
      if (videoId && videoId !== currentVideoId) {
        currentVideoId = videoId;
        console.log('📹 New YouTube video detected:', videoId);

        // Auto-start translation if enabled
        if (settings.enableTranslation && !isTranslationActive) {
          console.log('🚀 Auto-starting translation...');
          // Small delay to ensure video is ready
          setTimeout(() => {
            handleStartTranslation({ sourceLanguage: settings.sourceLanguage });
          }, 1000);
        }
      }
    }
  };

  // Check for video on page load
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', detectAndLoadVideo);
  } else {
    detectAndLoadVideo();
  }

  // Watch for video changes (YouTube navigation)
  const observer = new MutationObserver(detectAndLoadVideo);
  observer.observe(document.body, { childList: true, subtree: true });
}

// Check if we're on YouTube
function isYouTubePage() {
  return window.location.hostname.includes('youtube.com');
}

// Extract YouTube video ID
function extractYouTubeVideoId() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('v');
}

// Fetch YouTube transcript
async function fetchYouTubeTranscript(videoId) {
  try {
    console.log('📥 Fetching YouTube transcript for:', videoId);

    const playerResponse = await fetch(
      `https://www.youtube.com/youtubei/v1/player?key=AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoId: videoId,
          context: {
            client: {
              clientName: 'WEB',
              clientVersion: '2.20230101.00.00'
            }
          }
        })
      }
    );

    const playerData = await playerResponse.json();
    const captions = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

    if (!captions || captions.length === 0) {
      throw new Error('No captions available for this video');
    }

    // Find caption track matching source language
    let selectedTrack = captions.find(track =>
      track.languageCode === settings.sourceLanguage ||
      track.languageCode?.startsWith(settings.sourceLanguage)
    ) || captions[0]; // Fallback to first available

    console.log('📝 Selected caption track:', selectedTrack.name?.simpleText || selectedTrack.languageCode);

    // Fetch transcript XML
    const transcriptResponse = await fetch(selectedTrack.baseUrl);
    const transcriptXML = await transcriptResponse.text();

    // Parse XML
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(transcriptXML, 'text/xml');
    const textElements = xmlDoc.getElementsByTagName('text');

    const transcript = [];
    for (let element of textElements) {
      const text = element.textContent
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&apos;/g, "'");

      const start = parseFloat(element.getAttribute('start'));
      const duration = parseFloat(element.getAttribute('dur'));

      transcript.push({ text, start, duration });
    }

    console.log(`✅ Fetched ${transcript.length} transcript segments`);
    return transcript;

  } catch (error) {
    console.error('❌ Failed to fetch transcript:', error);
    throw error;
  }
}

// Translate transcript segments
async function translateTranscript(transcript) {
  try {
    console.log('🔄 Translating transcript...');

    const fullText = transcript.map(seg => seg.text).join(' ');

    const response = await fetch(`${API_URL}/api/translation/translate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: fullText,
        targetLanguage: settings.targetLanguage,
        sourceLanguage: settings.sourceLanguage
        // API key is stored on backend, not sent from client
      })
    });

    if (!response.ok) {
      throw new Error(`Translation failed: ${response.statusText}`);
    }

    const data = await response.json();
    console.log('✅ Translation complete');

    return data.translatedText;

  } catch (error) {
    console.error('❌ Translation error:', error);
    throw error;
  }
}

// Create or update UI panel
function createUIPanel() {
  if (unifiedPanel) {
    return; // Already exists
  }

  unifiedPanel = document.createElement('div');
  unifiedPanel.id = 'talkbridge-panel';
  unifiedPanel.innerHTML = `
    <style>
      #talkbridge-panel {
        position: fixed;
        bottom: 100px;
        right: 20px;
        width: 400px;
        max-height: 300px;
        background: rgba(0, 0, 0, 0.9);
        color: white;
        border-radius: 8px;
        padding: 15px;
        font-family: Arial, sans-serif;
        font-size: 14px;
        z-index: 10000;
        overflow-y: auto;
        box-shadow: 0 4px 12px rgba(0,0,0,0.5);
      }
      #talkbridge-panel h3 {
        margin: 0 0 10px 0;
        font-size: 16px;
        color: #4CAF50;
      }
      #talkbridge-status {
        margin-bottom: 10px;
        padding: 8px;
        background: rgba(255,255,255,0.1);
        border-radius: 4px;
      }
      #talkbridge-transcript {
        margin-top: 10px;
        padding: 10px;
        background: rgba(255,255,255,0.05);
        border-radius: 4px;
        max-height: 180px;
        overflow-y: auto;
        line-height: 1.5;
      }
      .talkbridge-segment {
        margin-bottom: 8px;
        padding: 4px;
      }
      .talkbridge-segment.active {
        background: rgba(76, 175, 80, 0.3);
        border-left: 3px solid #4CAF50;
        padding-left: 8px;
      }
      #talkbridge-close {
        position: absolute;
        top: 10px;
        right: 10px;
        cursor: pointer;
        font-size: 20px;
        color: #999;
      }
      #talkbridge-close:hover {
        color: white;
      }
    </style>
    <span id="talkbridge-close">×</span>
    <h3>🌉 TalkBridge</h3>
    <div id="talkbridge-status">Ready</div>
    <div id="talkbridge-transcript"></div>
  `;

  document.body.appendChild(unifiedPanel);

  // Close button
  document.getElementById('talkbridge-close').addEventListener('click', () => {
    unifiedPanel.style.display = 'none';
  });
}

// Update status message
function updateStatus(message, type = 'info') {
  const statusDiv = document.getElementById('talkbridge-status');
  if (statusDiv) {
    statusDiv.textContent = message;
    statusDiv.style.background =
      type === 'error' ? 'rgba(255, 0, 0, 0.2)' :
      type === 'success' ? 'rgba(76, 175, 80, 0.2)' :
      'rgba(255, 255, 255, 0.1)';
  }
}

// Display transcript in UI
function displayTranscript(transcript, translation) {
  const transcriptDiv = document.getElementById('talkbridge-transcript');
  if (!transcriptDiv) return;

  transcriptDiv.innerHTML = '';

  transcript.forEach((seg, index) => {
    const segDiv = document.createElement('div');
    segDiv.className = 'talkbridge-segment';
    segDiv.innerHTML = `
      <div style="color: #999; font-size: 11px;">
        ${formatTime(seg.start)}
      </div>
      <div style="color: white;">
        ${seg.text}
      </div>
      ${translation ? `<div style="color: #4CAF50; margin-top: 4px;">→ ${translation}</div>` : ''}
    `;
    transcriptDiv.appendChild(segDiv);
  });
}

// Format time (seconds to MM:SS)
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Handle messages from popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('📬 Message received:', message.action);

  if (message.action === 'startWebAudioCapture' || message.action === 'startTranslation') {
    handleStartTranslation(message).then(sendResponse);
    return true; // Keep channel open for async response
  }

  if (message.action === 'stopTranslation') {
    handleStopTranslation();
    sendResponse({ success: true });
    return true;
  }

  if (message.action === 'checkForMedia') {
    const hasVideo = document.querySelector('video') !== null;
    sendResponse({ hasMedia: hasVideo });
    return true;
  }
});

// Handle start translation
async function handleStartTranslation(message) {
  try {
    // Prevent multiple simultaneous translations
    if (isTranslationActive) {
      console.log('⚠️ Translation already in progress, ignoring request');
      return { success: false, error: 'Translation already active' };
    }

    isTranslationActive = true;
    console.log('▶️ Starting transcript-based translation...');

    // Update settings
    if (message.sourceLanguage) {
      settings.sourceLanguage = message.sourceLanguage;
    }

    // Create UI
    createUIPanel();
    unifiedPanel.style.display = 'block';
    updateStatus('Fetching transcript...', 'info');

    // Check if YouTube
    if (!isYouTubePage()) {
      updateStatus('Only YouTube supported currently', 'error');
      return { success: false, error: 'Not a YouTube page' };
    }

    const videoId = extractYouTubeVideoId();
    if (!videoId) {
      updateStatus('No video detected', 'error');
      return { success: false, error: 'No video ID found' };
    }

    // Fetch transcript
    transcript = await fetchYouTubeTranscript(videoId);
    updateStatus(`Fetched ${transcript.length} segments`, 'success');

    // Display original transcript
    displayTranscript(transcript, null);

    // Translate if target language is selected
    if (settings.targetLanguage) {
      updateStatus('Translating...', 'info');
      const translatedText = await translateTranscript(transcript);
      updateStatus('Translation complete!', 'success');

      // For now, show full translation (we can split it later)
      displayTranscript(transcript, translatedText);
    } else {
      updateStatus('No target language selected - showing original only', 'info');
    }

    return { success: true };

  } catch (error) {
    console.error('❌ Start translation failed:', error);
    updateStatus(`Error: ${error.message}`, 'error');
    return { success: false, error: error.message };
  } finally {
    isTranslationActive = false;
  }
}

// Handle stop translation
function handleStopTranslation() {
  console.log('⏹️ Stopping translation...');

  if (unifiedPanel) {
    unifiedPanel.style.display = 'none';
  }

  transcript = null;
  translations.clear();
  isTranslationActive = false;
}

// Initialize when script loads
init();
