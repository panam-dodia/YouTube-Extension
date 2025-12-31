// Content script - Improved Translation & Q&A
console.log('🌉 TalkBridge extension loaded (Improved)');

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
let translations = new Map();
let audioCache = new Map();
let unifiedPanel = null;
let currentAudio = null;
let detectedGender = 'male';
let isTranslating = false;
let currentSegmentIndex = 0;

// YouTube player reference
let player = null;

// Initialize extension
async function init() {
  const stored = await chrome.storage.sync.get({
    geminiApiKey: '',
    targetLanguage: '',
    enableTranslation: false,
    enableQA: false
  });
  settings = stored;

  currentVideoId = getVideoId();
  if (!currentVideoId) return;

  console.log('Current video:', currentVideoId);

  if ((settings.enableQA && settings.geminiApiKey) || (settings.enableTranslation && settings.targetLanguage)) {
    await loadVideoFeatures();
  }
}

function getVideoId() {
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('v');
}

async function loadVideoFeatures() {
  try {
    console.log('🎯 Loading video features...');

    transcript = await fetchYouTubeTranscript(currentVideoId);
    console.log(`✅ Fetched ${transcript.length} transcript segments`);

    transcriptText = transcript.map(t => t.text).join(' ');

    // Detect gender for better voice matching
    if (settings.enableTranslation && transcript.length > 0) {
      await detectSpeakerGender();
    }

    await chrome.storage.local.set({
      [`transcript_${currentVideoId}`]: {
        videoId: currentVideoId,
        transcript: transcript,
        timestamp: Date.now()
      }
    });

    // Create unified panel
    createUnifiedPanel();

    // Start progressive translation if enabled
    if (settings.enableTranslation && settings.targetLanguage) {
      startProgressiveTranslation();
    }

    // Get YouTube player reference
    getYouTubePlayer();

  } catch (error) {
    console.error('❌ Error loading features:', error);
    showNotification('Failed to fetch transcript. Video may not have captions.', 'error');
  }
}

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

async function detectSpeakerGender() {
  try {
    // Use larger sample for better detection
    const sample = transcript.slice(0, 10).map(s => s.text).join(' ');
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

// Create unified panel with tabs and FAB
function createUnifiedPanel() {
  if (unifiedPanel) return;

  const hasTranslation = settings.enableTranslation && settings.targetLanguage;
  const hasQA = settings.enableQA && settings.geminiApiKey;

  // Create FAB (Floating Action Button)
  const fab = document.createElement('div');
  fab.id = 'talkbridge-fab';
  fab.innerHTML = `
    <div class="fab-icon">🌉</div>
    <div class="fab-tooltip">TalkBridge</div>
  `;
  document.body.appendChild(fab);

  // Create main panel (initially hidden)
  unifiedPanel = document.createElement('div');
  unifiedPanel.id = 'talkbridge-unified-panel';
  unifiedPanel.className = 'hidden';

  unifiedPanel.innerHTML = `
    <div class="panel-header">
      <div class="header-content">
        <div class="brand">
          <span class="brand-icon">🌉</span>
          <span class="brand-name">TalkBridge</span>
        </div>
        <div class="header-actions">
          <button id="panel-minimize" class="icon-btn" title="Minimize">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M3 8h10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </button>
          <button id="panel-close" class="icon-btn" title="Close">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M12 4L4 12M4 4l8 8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
          </button>
        </div>
      </div>
    </div>

    ${(hasTranslation && hasQA) ? `
      <div class="panel-tabs">
        <button class="tab-btn active" data-tab="translation">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M10 2C5.58 2 2 5.58 2 10s3.58 8 8 8 8-3.58 8-8-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6s2.69-6 6-6 6 2.69 6 6-2.69 6-6 6z" fill="currentColor"/>
          </svg>
          <span>Translation</span>
        </button>
        <button class="tab-btn" data-tab="transcript">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M14 2H6c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-1 14H7v-2h6v2zm0-4H7V6h6v6z" fill="currentColor"/>
          </svg>
          <span>Transcript</span>
        </button>
        <button class="tab-btn" data-tab="qa">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M10 2C5.58 2 2 5.58 2 10c0 1.85.63 3.55 1.69 4.9L2.3 17.3a1 1 0 001.4 1.4l2.4-1.39A7.98 7.98 0 0010 18c4.42 0 8-3.58 8-8s-3.58-8-8-8z" fill="currentColor"/>
          </svg>
          <span>Chat</span>
        </button>
      </div>
    ` : ''}

    <div class="panel-content">
      ${hasTranslation ? `
        <div class="tab-content active" id="translation-tab">
          <div class="translation-status">
            <p id="translation-status-text">Starting translation...</p>
            <div class="progress-bar">
              <div class="progress-fill" id="translation-progress"></div>
            </div>
          </div>
          <div class="translation-list" id="translation-list"></div>
        </div>

        <div class="tab-content" id="transcript-tab">
          <div class="transcript-list" id="transcript-list"></div>
        </div>
      ` : ''}

      ${hasQA ? `
        <div class="tab-content ${!hasTranslation ? 'active' : ''}" id="qa-tab">
          <div class="qa-messages" id="qa-messages">
            <div class="qa-message bot">
              <div class="message-avatar">🤖</div>
              <div class="message-content">Hi! Ask me anything about this video.</div>
            </div>
          </div>
          <div class="qa-input-container">
            <input type="text" id="qa-input" placeholder="Ask a question...">
            <button id="qa-send">
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M2 10l16-8-6 16-2-6-8-2z" fill="currentColor"/>
              </svg>
            </button>
          </div>
        </div>
      ` : ''}
    </div>
  `;

  document.body.appendChild(unifiedPanel);

  // Populate transcript tab immediately (works without translation)
  const transcriptList = document.getElementById('transcript-list');
  if (transcriptList && transcript) {
    transcript.forEach((segment, index) => {
      addTranscriptItem(index, segment, transcriptList);
    });
  }

  // FAB click to toggle panel
  fab.addEventListener('click', () => {
    unifiedPanel.classList.toggle('hidden');
    fab.classList.toggle('active');
  });

  // Event listeners
  document.getElementById('panel-minimize')?.addEventListener('click', () => {
    unifiedPanel.classList.add('hidden');
    fab.classList.remove('active');
  });

  document.getElementById('panel-close').addEventListener('click', () => {
    unifiedPanel.classList.add('hidden');
    fab.classList.remove('active');
  });

  // Tab switching
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const target = e.currentTarget;
      const tab = target.dataset.tab;
      switchTab(tab);
    });
  });

  // Q&A listeners
  if (hasQA) {
    document.getElementById('qa-send')?.addEventListener('click', sendQuestion);
    document.getElementById('qa-input')?.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') sendQuestion();
    });
  }
}

function switchTab(tabName) {
  // Update tab buttons
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });

  // Update tab content
  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.toggle('active', content.id === `${tabName}-tab`);
  });
}

// Progressive translation - translate and play as segments become available
async function startProgressiveTranslation() {
  isTranslating = true;
  const statusText = document.getElementById('translation-status-text');
  const progressBar = document.getElementById('translation-progress');
  const translationList = document.getElementById('translation-list');
  const transcriptList = document.getElementById('transcript-list');

  if (statusText) {
    statusText.textContent = `Translating to ${settings.targetLanguage}...`;
  }

  for (let i = 0; i < transcript.length && isTranslating; i++) {
    const segment = transcript[i];

    try {
      // Translate segment
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

        // Add to UI immediately
        addTranslationItem(i, segment, data.translatedText, translationList);
        addTranscriptItem(i, segment, transcriptList);

        // Generate audio in background for upcoming segments
        if (i < 10 || (i >= currentSegmentIndex && i < currentSegmentIndex + 5)) {
          generateAudio(i, data.translatedText);
        }

        // Update status
        if (statusText && i === 0) {
          statusText.textContent = `Translated ${i + 1}/${transcript.length} segments`;
        }
      }

      // Small delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));

    } catch (error) {
      console.error(`Error translating segment ${i}:`, error);

      // If we hit quota limits, show helpful message
      if (error.message && error.message.includes('quota')) {
        if (statusText) {
          statusText.textContent = `⚠️ API quota exceeded. Translation paused at ${i}/${transcript.length} segments.`;
          statusText.style.color = '#ff6b6b';
        }
        showNotification('Gemini API quota exceeded. Try again tomorrow or use a different API key.', 'error');
        break; // Stop translating
      }
    }
  }

  if (statusText && isTranslating) {
    statusText.textContent = `Translation complete! (${transcript.length} segments)`;
  }
}

function addTranslationItem(index, segment, translatedText, container) {
  if (!container) return;

  const item = document.createElement('div');
  item.className = 'translation-item';
  item.dataset.index = index;
  item.innerHTML = `
    <div class="timestamp">${formatTime(segment.start)}</div>
    <div class="original-text">${segment.text}</div>
    <div class="translated-text">${translatedText}</div>
    <button class="play-audio-btn" data-index="${index}">▶ Play</button>
  `;

  container.appendChild(item);

  // Add play listener
  item.querySelector('.play-audio-btn').addEventListener('click', async (e) => {
    const idx = parseInt(e.target.dataset.index);
    await playSegmentAudio(idx);
  });
}

function addTranscriptItem(index, segment, container) {
  if (!container) return;

  const item = document.createElement('div');
  item.className = 'transcript-item';
  item.dataset.index = index;
  item.innerHTML = `
    <div class="timestamp">${formatTime(segment.start)}</div>
    <div class="transcript-text">${segment.text}</div>
  `;

  container.appendChild(item);
}

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

async function playSegmentAudio(index) {
  let audioBlob = audioCache.get(index);

  if (!audioBlob) {
    const translatedText = translations.get(index);
    if (!translatedText) return;

    await generateAudio(index, translatedText);
    audioBlob = audioCache.get(index);
  }

  if (audioBlob) {
    if (currentAudio) {
      currentAudio.pause();
      currentAudio = null;
    }

    const audioURL = URL.createObjectURL(audioBlob);
    currentAudio = new Audio(audioURL);
    currentAudio.play();

    currentAudio.onended = () => {
      URL.revokeObjectURL(audioURL);
      currentAudio = null;
    };
  }
}

function getYouTubePlayer() {
  const video = document.querySelector('video');
  if (video) {
    player = video;
  }
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

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

  } catch (error) {
    console.error('Error asking question:', error);
    thinkingMsg.remove();
    addMessage('Sorry, I encountered an error: ' + error.message, 'bot');
  }
}

function addMessage(text, sender) {
  const messagesContainer = document.getElementById('qa-messages');
  if (!messagesContainer) return null;

  const messageDiv = document.createElement('div');
  messageDiv.className = `qa-message ${sender}`;

  const avatar = document.createElement('div');
  avatar.className = 'message-avatar';
  avatar.textContent = sender === 'user' ? '👤' : '🤖';

  const content = document.createElement('div');
  content.className = 'message-content';
  content.textContent = text;

  messageDiv.appendChild(avatar);
  messageDiv.appendChild(content);
  messagesContainer.appendChild(messageDiv);
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
  return messageDiv;
}

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

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'UPDATE_SETTINGS') {
    settings = message.settings;
    console.log('Settings updated:', settings);

    if (currentVideoId === getVideoId()) {
      if ((settings.enableQA && !unifiedPanel && settings.geminiApiKey) ||
          (settings.enableTranslation && !unifiedPanel && settings.targetLanguage)) {
        loadVideoFeatures();
      }
    }
  }
});

let lastVideoId = null;
setInterval(() => {
  const videoId = getVideoId();
  if (videoId && videoId !== lastVideoId) {
    lastVideoId = videoId;
    currentVideoId = videoId;
    console.log('Video changed:', videoId);

    if (unifiedPanel) {
      unifiedPanel.remove();
      unifiedPanel = null;
    }

    translations.clear();
    audioCache.clear();
    isTranslating = false;

    if ((settings.enableQA && settings.geminiApiKey) ||
        (settings.enableTranslation && settings.targetLanguage)) {
      loadVideoFeatures();
    }
  }
}, 1000);

init();
