// Content script - runs on YouTube pages
console.log('🌉 TalkBridge extension loaded');

const BACKEND_URL = 'https://talkbridge-backend-149462569558.us-central1.run.app';

// State
let settings = {
  targetLanguage: 'English',
  enableTranslation: false,
  enableQA: false,
  enableDubbing: false
};
let currentVideoId = null;
let sessionId = null;
let transcript = null;
let qaPanel = null;

// Initialize extension
async function init() {
  // Load settings
  settings = await chrome.storage.sync.get({
    targetLanguage: 'English',
    enableTranslation: false,
    enableQA: false,
    enableDubbing: false
  });

  // Get current video ID
  currentVideoId = getVideoId();
  if (!currentVideoId) return;

  console.log('Current video:', currentVideoId);

  // Apply features based on settings
  if (settings.enableTranslation || settings.enableQA || settings.enableDubbing) {
    await loadVideoFeatures();
  }
}

// Extract video ID from URL
function getVideoId() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('v');
}

// Load video features (translation, Q&A, dubbing)
async function loadVideoFeatures() {
  try {
    console.log('🎯 Loading video features...');

    // Fetch transcript from YouTube
    transcript = await fetchYouTubeTranscript(currentVideoId);
    console.log(`✅ Fetched ${transcript.length} transcript segments`);

    // Create session on backend
    const response = await fetch(`${BACKEND_URL}/api/youtube/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: `https://www.youtube.com/watch?v=${currentVideoId}`,
        userId: await getUserId(),
        transcript: transcript,
        targetLanguage: settings.targetLanguage
      })
    });

    const data = await response.json();
    sessionId = data.sessionId;
    console.log('✅ Session created:', sessionId);

    // Enable Q&A panel if enabled
    if (settings.enableQA) {
      createQAPanel();
    }

    // Enable translation overlay if enabled
    if (settings.enableTranslation) {
      createTranslationOverlay(data.transcript);
    }

  } catch (error) {
    console.error('❌ Error loading features:', error);
    showNotification('Failed to load TalkBridge features. Please refresh the page.', 'error');
  }
}

// Fetch YouTube transcript using Innertube API
async function fetchYouTubeTranscript(videoId) {
  const INNERTUBE_API_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

  try {
    // Fetch player data
    const playerResponse = await fetch(
      `https://www.youtube.com/youtubei/v1/player?key=${INNERTUBE_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          context: {
            client: {
              clientName: 'WEB',
              clientVersion: '2.20250110.01.00',
              hl: 'en',
              gl: 'US'
            }
          },
          videoId: videoId
        })
      }
    );

    const playerData = await playerResponse.json();
    const captions = playerData?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

    if (!captions || captions.length === 0) {
      throw new Error('No captions available');
    }

    // Get English captions or first available
    let selectedTrack = captions.find(track =>
      track.languageCode === 'en' || track.languageCode?.startsWith('en')
    ) || captions[0];

    // Fetch transcript XML
    const transcriptResponse = await fetch(selectedTrack.baseUrl);
    const transcriptXML = await transcriptResponse.text();

    // Parse XML to extract transcript segments
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

    return transcript;

  } catch (error) {
    console.error('Failed to fetch transcript:', error);
    throw error;
  }
}

// Create Q&A panel
function createQAPanel() {
  if (qaPanel) return; // Already created

  qaPanel = document.createElement('div');
  qaPanel.id = 'talkbridge-qa-panel';
  qaPanel.innerHTML = `
    <div class="qa-header">
      <h3>🤔 Ask about this video</h3>
      <button id="qa-close">✕</button>
    </div>
    <div class="qa-messages" id="qa-messages">
      <div class="qa-message bot">
        Hi! Ask me anything about this video.
      </div>
    </div>
    <div class="qa-input-container">
      <input type="text" id="qa-input" placeholder="Ask a question...">
      <button id="qa-send">Send</button>
    </div>
  `;

  document.body.appendChild(qaPanel);

  // Event listeners
  document.getElementById('qa-close').addEventListener('click', () => {
    qaPanel.style.display = 'none';
  });

  document.getElementById('qa-send').addEventListener('click', sendQuestion);
  document.getElementById('qa-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendQuestion();
  });
}

// Send question to backend
async function sendQuestion() {
  const input = document.getElementById('qa-input');
  const question = input.value.trim();
  if (!question) return;

  // Add user message to chat
  addMessage(question, 'user');
  input.value = '';

  try {
    const response = await fetch(`${BACKEND_URL}/api/youtube/qa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sessionId: sessionId,
        question: question
      })
    });

    const data = await response.json();
    addMessage(data.answer, 'bot');

  } catch (error) {
    console.error('Error asking question:', error);
    addMessage('Sorry, I encountered an error. Please try again.', 'bot');
  }
}

// Add message to Q&A panel
function addMessage(text, sender) {
  const messagesContainer = document.getElementById('qa-messages');
  const messageDiv = document.createElement('div');
  messageDiv.className = `qa-message ${sender}`;
  messageDiv.textContent = text;
  messagesContainer.appendChild(messageDiv);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Create translation overlay (subtitle replacement)
function createTranslationOverlay(translatedTranscript) {
  console.log('Translation overlay feature coming soon...');
  // TODO: Implement subtitle overlay that syncs with video
}

// Get or create user ID
async function getUserId() {
  let { userId } = await chrome.storage.local.get('userId');
  if (!userId) {
    userId = 'ext_' + Math.random().toString(36).substr(2, 9);
    await chrome.storage.local.set({ userId });
  }
  return userId;
}

// Show notification
function showNotification(message, type = 'info') {
  const notification = document.createElement('div');
  notification.className = `talkbridge-notification ${type}`;
  notification.textContent = message;
  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.opacity = '0';
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

// Listen for settings updates
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'UPDATE_SETTINGS') {
    settings = message.settings;
    console.log('Settings updated:', settings);

    // Reload features if video ID hasn't changed
    if (currentVideoId === getVideoId()) {
      if (settings.enableQA && !qaPanel) {
        loadVideoFeatures();
      }
    }
  }
});

// Watch for video changes (YouTube is SPA)
let lastVideoId = null;
setInterval(() => {
  const videoId = getVideoId();
  if (videoId && videoId !== lastVideoId) {
    lastVideoId = videoId;
    currentVideoId = videoId;
    console.log('Video changed:', videoId);

    // Reload features for new video
    if (settings.enableTranslation || settings.enableQA || settings.enableDubbing) {
      loadVideoFeatures();
    }
  }
}, 1000);

// Initialize on load
init();