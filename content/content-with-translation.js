// Content script - With Translation & TTS via Backend
console.log('🌉 TalkBridge extension loaded (With Translation)');

// Import API functions
// Note: API calls defined inline since we can't use ES6 imports in content scripts

const API_URL = 'http://localhost:8080';

// State
let settings = {
  geminiApiKey: '',
  targetLanguage: '',
  enableTranslation: false,
  enableQA: false
};
let currentVideoId = null;
let transcript = null;
let transcriptText = '';
let translations = new Map(); // Map<index, translatedText>
let audioCache = new Map(); // Map<index, audioBlob>
let qaPanel = null;
let qaHistory = [];
let translationPanel = null;
let currentAudio = null;
let detectedGender = 'male';

// Initialize extension
async function init() {
  // Load settings
  const stored = await chrome.storage.sync.get({
    geminiApiKey: '',
    targetLanguage: '',
    enableTranslation: false,
    enableQA: false
  });
  settings = stored;

  // Get current video ID
  currentVideoId = getVideoId();
  if (!currentVideoId) return;

  console.log('Current video:', currentVideoId);

  // Load features if enabled
  if ((settings.enableQA && settings.geminiApiKey) || (settings.enableTranslation && settings.targetLanguage)) {
    await loadVideoFeatures();
  }
}

// Extract video ID from URL
function getVideoId() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('v');
}

// Load video features
async function loadVideoFeatures() {
  try {
    console.log('🎯 Loading video features...');

    // Fetch transcript from YouTube
    transcript = await fetchYouTubeTranscript(currentVideoId);
    console.log(`✅ Fetched ${transcript.length} transcript segments`);

    // Combine into full text for context
    transcriptText = transcript.map(t => t.text).join(' ');
    console.log(`📝 Total transcript length: ${transcriptText.length} characters`);

    // Detect gender for better voice matching
    if (settings.enableTranslation && transcript.length > 0) {
      await detectSpeakerGender();
    }

    // Store locally
    await chrome.storage.local.set({
      [`transcript_${currentVideoId}`]: {
        videoId: currentVideoId,
        transcript: transcript,
        timestamp: Date.now()
      }
    });

    // Enable features based on settings
    if (settings.enableTranslation && settings.targetLanguage) {
      createTranslationPanel();
      // Start translating segments
      await translateAllSegments();
    }

    if (settings.enableQA && settings.geminiApiKey) {
      createQAPanel();
    }

  } catch (error) {
    console.error('❌ Error loading features:', error);
    showNotification('Failed to fetch transcript. Video may not have captions.', 'error');
  }
}

// Fetch YouTube transcript using Innertube API
async function fetchYouTubeTranscript(videoId) {
  const INNERTUBE_API_KEY = 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8';

  try {
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

    let selectedTrack = captions.find(track =>
      track.languageCode === 'en' || track.languageCode?.startsWith('en')
    ) || captions[0];

    const transcriptResponse = await fetch(selectedTrack.baseUrl);
    const transcriptXML = await transcriptResponse.text();

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

// Detect speaker gender using backend
async function detectSpeakerGender() {
  try {
    const sample = transcript.slice(0, 5).map(s => s.text).join(' ');
    const response = await fetch(`${API_URL}/api/translation/detect-gender`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transcriptSample: sample })
    });

    if (response.ok) {
      const data = await response.json();
      detectedGender = data.gender;
      console.log(`🎙️ Detected gender: ${detectedGender}`);
    }
  } catch (error) {
    console.error('Gender detection error:', error);
    detectedGender = 'male'; // Default
  }
}

// Create translation panel
function createTranslationPanel() {
  if (translationPanel) return;

  translationPanel = document.createElement('div');
  translationPanel.id = 'talkbridge-translation-panel';
  translationPanel.innerHTML = `
    <div class="translation-header">
      <h3>🌐 Translation (${settings.targetLanguage})</h3>
      <button id="translation-close">✕</button>
    </div>
    <div class="translation-content" id="translation-content">
      <div class="translation-loading">
        <p>Translating segments...</p>
        <div class="progress-bar">
          <div class="progress-fill" id="translation-progress"></div>
        </div>
      </div>
    </div>
  `;

  document.body.appendChild(translationPanel);

  document.getElementById('translation-close').addEventListener('click', () => {
    translationPanel.style.display = 'none';
  });
}

// Translate all transcript segments
async function translateAllSegments() {
  const progressBar = document.getElementById('translation-progress');
  const content = document.getElementById('translation-content');

  for (let i = 0; i < transcript.length; i++) {
    const segment = transcript[i];

    try {
      // Translate
      const response = await fetch(`${API_URL}/api/translation/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: segment.text,
          targetLanguage: settings.targetLanguage
        })
      });

      if (response.ok) {
        const data = await response.json();
        translations.set(i, data.translatedText);

        // Update progress
        const progress = ((i + 1) / transcript.length) * 100;
        if (progressBar) {
          progressBar.style.width = `${progress}%`;
        }

        // Preload audio for first few segments
        if (i < 5) {
          await generateAudio(i, data.translatedText);
        }
      }
    } catch (error) {
      console.error(`Error translating segment ${i}:`, error);
    }
  }

  // Update UI to show translated segments
  displayTranslations();
}

// Generate audio for translated text
async function generateAudio(index, translatedText) {
  try {
    const response = await fetch(`${API_URL}/api/translation/text-to-speech`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: translatedText,
        gender: detectedGender,
        language: settings.targetLanguage
      })
    });

    if (response.ok) {
      const audioBlob = await response.blob();
      audioCache.set(index, audioBlob);
      console.log(`🎵 Cached audio for segment ${index}`);
    }
  } catch (error) {
    console.error(`Error generating audio for segment ${index}:`, error);
  }
}

// Display translations
function displayTranslations() {
  const content = document.getElementById('translation-content');
  if (!content) return;

  content.innerHTML = '';

  const translationList = document.createElement('div');
  translationList.className = 'translation-list';

  transcript.forEach((segment, index) => {
    const translatedText = translations.get(index) || 'Translating...';

    const item = document.createElement('div');
    item.className = 'translation-item';
    item.dataset.index = index;
    item.innerHTML = `
      <div class="timestamp">${formatTime(segment.start)}</div>
      <div class="original-text">${segment.text}</div>
      <div class="translated-text">${translatedText}</div>
      <button class="play-audio-btn" data-index="${index}">▶ Play</button>
    `;

    translationList.appendChild(item);
  });

  content.appendChild(translationList);

  // Add click listeners to play buttons
  document.querySelectorAll('.play-audio-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const index = parseInt(e.target.dataset.index);
      await playSegmentAudio(index);
    });
  });
}

// Play audio for a specific segment
async function playSegmentAudio(index) {
  let audioBlob = audioCache.get(index);

  // Generate if not cached
  if (!audioBlob) {
    const translatedText = translations.get(index);
    if (!translatedText) return;

    await generateAudio(index, translatedText);
    audioBlob = audioCache.get(index);
  }

  if (audioBlob) {
    // Stop current audio if playing
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }

    // Create and play new audio
    const audioURL = URL.createObjectURL(audioBlob);
    currentAudio = new Audio(audioURL);
    currentAudio.play();

    currentAudio.onended = () => {
      URL.revokeObjectURL(audioURL);
      currentAudio = null;
    };
  }
}

// Format time (seconds to MM:SS)
function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Create Q&A panel
function createQAPanel() {
  if (qaPanel) return;

  qaPanel = document.createElement('div');
  qaPanel.id = 'talkbridge-qa-panel';
  qaPanel.innerHTML = `
    <div class="qa-header">
      <h3>🤔 Ask about this video</h3>
      <button id="qa-close">✕</button>
    </div>
    <div class="qa-messages" id="qa-messages">
      <div class="qa-message bot">
        Hi! I've analyzed this video. Ask me anything about it.
      </div>
    </div>
    <div class="qa-input-container">
      <input type="text" id="qa-input" placeholder="Ask a question...">
      <button id="qa-send">Send</button>
    </div>
  `;

  document.body.appendChild(qaPanel);

  document.getElementById('qa-close').addEventListener('click', () => {
    qaPanel.style.display = 'none';
  });

  document.getElementById('qa-send').addEventListener('click', sendQuestion);
  document.getElementById('qa-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendQuestion();
  });
}

// Send question (using backend)
async function sendQuestion() {
  const input = document.getElementById('qa-input');
  const question = input.value.trim();
  if (!question) return;

  addMessage(question, 'user');
  input.value = '';

  const thinkingMsg = addMessage('Thinking...', 'bot');

  try {
    const response = await fetch(`${API_URL}/api/translation/qa`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        question,
        transcript: transcriptText,
        targetLanguage: 'English'
      })
    });

    if (!response.ok) {
      throw new Error('Failed to get answer from backend');
    }

    const data = await response.json();
    thinkingMsg.remove();
    addMessage(data.answer, 'bot');

    qaHistory.push({ question, answer: data.answer, videoId: currentVideoId });
  } catch (error) {
    console.error('Error asking question:', error);
    thinkingMsg.remove();
    addMessage('Sorry, I encountered an error: ' + error.message, 'bot');
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
  return messageDiv;
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

    if (currentVideoId === getVideoId()) {
      // Reload features if needed
      if ((settings.enableQA && !qaPanel && settings.geminiApiKey) ||
          (settings.enableTranslation && !translationPanel && settings.targetLanguage)) {
        loadVideoFeatures();
      }
    }
  }
});

// Watch for video changes
let lastVideoId = null;
setInterval(() => {
  const videoId = getVideoId();
  if (videoId && videoId !== lastVideoId) {
    lastVideoId = videoId;
    currentVideoId = videoId;
    console.log('Video changed:', videoId);

    // Reset panels
    if (qaPanel) {
      qaPanel.remove();
      qaPanel = null;
    }
    if (translationPanel) {
      translationPanel.remove();
      translationPanel = null;
    }

    // Clear caches
    translations.clear();
    audioCache.clear();

    // Reload features
    if ((settings.enableQA && settings.geminiApiKey) ||
        (settings.enableTranslation && settings.targetLanguage)) {
      loadVideoFeatures();
    }
  }
}, 1000);

// Initialize
init();
