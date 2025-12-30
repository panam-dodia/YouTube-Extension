// Content script - STANDALONE YouTube Extension (No Backend Required)
console.log('🌉 TalkBridge extension loaded (Standalone Mode)');

// State
let settings = {
  geminiApiKey: '',
  targetLanguage: 'English',
  enableQA: false
};
let currentVideoId = null;
let transcript = null;
let transcriptText = '';
let qaPanel = null;
let qaHistory = [];

// Initialize extension
async function init() {
  // Load settings
  const stored = await chrome.storage.sync.get({
    geminiApiKey: '',
    targetLanguage: 'English',
    enableQA: false
  });
  settings = stored;

  // Get current video ID
  currentVideoId = getVideoId();
  if (!currentVideoId) return;

  console.log('Current video:', currentVideoId);

  // Load features if enabled
  if (settings.enableQA && settings.geminiApiKey) {
    await loadVideoFeatures();
  } else if (settings.enableQA && !settings.geminiApiKey) {
    showNotification('Please add your Gemini API key in extension settings', 'error');
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

    // Store locally
    await chrome.storage.local.set({
      [`transcript_${currentVideoId}`]: {
        videoId: currentVideoId,
        transcript: transcript,
        timestamp: Date.now()
      }
    });

    // Enable Q&A panel
    if (settings.enableQA) {
      createQAPanel();
    }

  } catch (error) {
    console.error('❌ Error loading features:', error);
    showNotification('Failed to fetch transcript. Video may not have captions.', 'error');
  }
}

// Fetch YouTube transcript using Innertube API (Direct - Works from Browser)
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

    return transcript;

  } catch (error) {
    console.error('Failed to fetch transcript:', error);
    throw error;
  }
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

  // Event listeners
  document.getElementById('qa-close').addEventListener('click', () => {
    qaPanel.style.display = 'none';
  });

  document.getElementById('qa-send').addEventListener('click', sendQuestion);
  document.getElementById('qa-input').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendQuestion();
  });
}

// Send question to Gemini API (Standalone - No Backend)
async function sendQuestion() {
  const input = document.getElementById('qa-input');
  const question = input.value.trim();
  if (!question) return;

  // Add user message
  addMessage(question, 'user');
  input.value = '';

  // Add thinking indicator
  const thinkingMsg = addMessage('Thinking...', 'bot');

  try {
    // Prepare context for Gemini
    const prompt = `You are analyzing a YouTube video transcript. Answer the user's question based ONLY on the transcript provided.

TRANSCRIPT:
${transcriptText}

USER QUESTION: ${question}

Provide a clear, concise answer based on the transcript. If the transcript doesn't contain relevant information, say so.`;

    // Call Gemini API
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent?key=${settings.geminiApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: prompt }]
          }]
        })
      }
    );

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || 'API request failed');
    }

    const data = await response.json();
    const answer = data.candidates[0]?.content?.parts[0]?.text || 'No response generated';

    // Remove thinking indicator
    thinkingMsg.remove();

    // Add answer
    addMessage(answer, 'bot');

    // Store in history
    qaHistory.push({ question, answer, videoId: currentVideoId });

  } catch (error) {
    console.error('Error asking question:', error);
    thinkingMsg.remove();

    if (error.message.includes('API_KEY_INVALID') || error.message.includes('API key')) {
      addMessage('Invalid API key. Please check your Gemini API key in settings.', 'bot');
    } else {
      addMessage('Sorry, I encountered an error: ' + error.message, 'bot');
    }
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
      if (settings.enableQA && !qaPanel && settings.geminiApiKey) {
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

    // Reset Q&A panel
    if (qaPanel) {
      qaPanel.remove();
      qaPanel = null;
    }

    // Reload features
    if (settings.enableQA && settings.geminiApiKey) {
      loadVideoFeatures();
    }
  }
}, 1000);

// Initialize
init();