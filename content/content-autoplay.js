// Content script - Auto-play Translation with YouTube Sync
console.log('🌉 TalkBridge extension loaded (Auto-play)');

const API_URL = 'http://talkbridge-prod.eba-h9t94spu.us-east-1.elasticbeanstalk.com';
const BUFFER_SIZE = 3; // Number of segments to buffer before auto-play

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
let isPlaying = false;
let hasAutoStarted = false;
let youtubeVideo = null;
let playbackQueue = [];
let groupedSentences = [];

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

    // Get YouTube player reference
    getYouTubePlayer();

    // Create unified panel
    createUnifiedPanel();

    // Start progressive translation if enabled
    if (settings.enableTranslation && settings.targetLanguage) {
      startProgressiveTranslation();
    }

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
    detectedGender = 'male';
  }
}

function getYouTubePlayer() {
  youtubeVideo = document.querySelector('video');
  if (youtubeVideo) {
    console.log('✅ Found YouTube video element');

    // Add event listeners for YouTube play/pause sync
    youtubeVideo.addEventListener('pause', () => {
      if (isPlaying) {
        console.log('🎬 YouTube paused - pausing translation');
        pausePlayback();
      }
    });

    youtubeVideo.addEventListener('play', () => {
      if (!isPlaying && audioCache.size > 0) {
        console.log('▶️ YouTube playing - resuming translation');
        resumePlayback();
      }
    });
  }
}

// Create unified panel with auto-play controls
function createUnifiedPanel() {
  if (unifiedPanel) return;

  // Remove any existing FAB or panel (in case of duplicate script load)
  const existingFab = document.getElementById('talkbridge-fab');
  const existingPanel = document.getElementById('talkbridge-unified-panel');
  if (existingFab) existingFab.remove();
  if (existingPanel) existingPanel.remove();

  const hasTranslation = settings.enableTranslation && settings.targetLanguage;
  const hasQA = settings.enableQA && settings.geminiApiKey;

  // Create FAB
  const fab = document.createElement('div');
  fab.id = 'talkbridge-fab';
  fab.innerHTML = `
    <div class="fab-icon">🌉</div>
    <div class="fab-tooltip">TalkBridge</div>
  `;
  document.body.appendChild(fab);

  // Create main panel
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
          <div class="translation-list" id="translation-list"></div>
          <div class="translation-controls">
            <p id="translation-status-text">Preparing smooth translation... For best experience, let it auto-play!</p>
            <div class="playback-controls">
              <button id="play-btn" class="control-btn" style="display: none;">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M8 5v14l11-7z"/>
                </svg>
                <span>Play</span>
              </button>
              <button id="pause-btn" class="control-btn" style="display: none;">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z"/>
                </svg>
                <span>Pause</span>
              </button>
            </div>
          </div>
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

  // Populate transcript tab
  const transcriptList = document.getElementById('transcript-list');
  if (transcriptList && transcript) {
    transcript.forEach((segment, index) => {
      addTranscriptItem(index, segment, transcriptList);
    });
  }

  // Event listeners
  fab.addEventListener('click', () => {
    unifiedPanel.classList.toggle('hidden');
    fab.classList.toggle('active');
  });

  document.getElementById('panel-minimize')?.addEventListener('click', () => {
    unifiedPanel.classList.add('hidden');
    fab.classList.remove('active');
  });

  document.getElementById('panel-close').addEventListener('click', () => {
    unifiedPanel.classList.add('hidden');
    fab.classList.remove('active');
  });

  // Playback controls
  document.getElementById('play-btn')?.addEventListener('click', resumePlayback);
  document.getElementById('pause-btn')?.addEventListener('click', pausePlayback);

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
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });

  document.querySelectorAll('.tab-content').forEach(content => {
    content.classList.toggle('active', content.id === `${tabName}-tab`);
  });
}

// Group transcript segments into complete sentences
function groupIntoSentences(transcript) {
  const sentences = [];
  let currentSentence = {
    text: '',
    start: 0,
    duration: 0,
    segmentIndices: []
  };

  for (let i = 0; i < transcript.length; i++) {
    const segment = transcript[i];

    // Start new sentence if this is the first segment
    if (currentSentence.text === '') {
      currentSentence.start = segment.start;
    }

    // Add segment to current sentence
    currentSentence.text += (currentSentence.text ? ' ' : '') + segment.text;
    currentSentence.duration += segment.duration;
    currentSentence.segmentIndices.push(i);

    // Check if this segment ends a sentence (ends with . ! ? or is last segment)
    const endsWithPunctuation = /[.!?]$/.test(segment.text.trim());
    const isLastSegment = i === transcript.length - 1;

    // Also end sentence if it's getting too long (20+ segments or 60+ seconds)
    const tooLong = currentSentence.segmentIndices.length >= 20 || currentSentence.duration >= 60;

    if (endsWithPunctuation || isLastSegment || tooLong) {
      console.log(`📝 Sentence ${sentences.length}: "${currentSentence.text.substring(0, 50)}..." (${currentSentence.segmentIndices.length} segments, ${currentSentence.duration.toFixed(1)}s)`);
      sentences.push({ ...currentSentence });
      currentSentence = {
        text: '',
        start: 0,
        duration: 0,
        segmentIndices: []
      };
    }
  }

  console.log(`📝 Grouped ${transcript.length} segments into ${sentences.length} sentences`);
  return sentences;
}

// Progressive translation with auto-play
async function startProgressiveTranslation() {
  isTranslating = true;
  const statusText = document.getElementById('translation-status-text');
  const translationList = document.getElementById('translation-list');

  // Clear existing translations to prevent duplicates
  if (translationList) {
    translationList.innerHTML = '';
  }
  translations.clear();
  audioCache.clear();
  currentSegmentIndex = 0;
  hasAutoStarted = false;

  // Group segments into complete sentences
  groupedSentences = groupIntoSentences(transcript);

  for (let i = 0; i < groupedSentences.length && isTranslating; i++) {
    const sentence = groupedSentences[i];

    try {
      // Translate complete sentence
      const response = await fetch(`${API_URL}/api/translation/translate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: sentence.text,
          targetLanguage: settings.targetLanguage
        })
      });

      if (response.ok) {
        const data = await response.json();
        translations.set(i, data.translatedText);

        console.log(`🔄 Sentence ${i}:`);
        console.log(`   Original: "${sentence.text}"`);
        console.log(`   Translated: "${data.translatedText}"`);

        // Add to UI
        addTranslationItem(i, data.translatedText, translationList, sentence);

        // Generate audio
        await generateAudio(i, data.translatedText);

        // Auto-start when buffer is ready
        console.log(`📊 Checking auto-play: hasAutoStarted=${hasAutoStarted}, audioCache.size=${audioCache.size}, BUFFER_SIZE=${BUFFER_SIZE}`);
        if (!hasAutoStarted && audioCache.size >= BUFFER_SIZE) {
          console.log(`🎬 Buffer ready! Starting auto-play with ${audioCache.size} sentences`);
          hasAutoStarted = true;
          if (statusText) {
            statusText.textContent = `Playing translation...`;
          }
          autoStartPlayback(); // Don't await - start in parallel
        }

        // Small delay
        await new Promise(resolve => setTimeout(resolve, 100));
      }

    } catch (error) {
      console.error(`Error translating segment ${i}:`, error);
      if (error.message && error.message.includes('quota')) {
        if (statusText) {
          statusText.textContent = `⚠️ API quota exceeded. Translation paused.`;
        }
        showNotification('Gemini API quota exceeded.', 'error');
        break;
      }
    }
  }

  if (statusText && isTranslating) {
    statusText.textContent = `Translation complete!`;
  }
}

function addTranslationItem(index, translatedText, container, sentence) {
  if (!container) return;

  const item = document.createElement('div');
  item.className = 'translation-item';
  item.dataset.index = index;
  item.innerHTML = `
    <div class="timestamp">${formatTime(sentence.start)}</div>
    <div class="translated-text">${translatedText}</div>
  `;

  container.appendChild(item);
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
      console.log(`🎵 Cached audio for segment ${index}, total cached: ${audioCache.size}/${BUFFER_SIZE}`);

      // Add to playback queue
      playbackQueue.push(index);
    }
  } catch (error) {
    console.error(`Error generating audio for segment ${index}:`, error);
  }
}

async function autoStartPlayback() {
  console.log(`🎬 autoStartPlayback() called, youtubeVideo=${!!youtubeVideo}`);

  if (youtubeVideo) {
    console.log(`🔇 Muting YouTube video`);
    youtubeVideo.muted = true;
    youtubeVideo.play();
  } else {
    console.warn('⚠️ YouTube video element not found, trying to get it again...');
    getYouTubePlayer();
    if (youtubeVideo) {
      youtubeVideo.muted = true;
      youtubeVideo.play();
    }
  }

  const playBtn = document.getElementById('play-btn');
  const pauseBtn = document.getElementById('pause-btn');

  if (playBtn) playBtn.style.display = 'none';
  if (pauseBtn) pauseBtn.style.display = 'flex';

  isPlaying = true;
  console.log(`▶️ Starting playback from segment ${currentSegmentIndex}`);
  await playNextSegment();
}

async function playNextSegment() {
  if (!isPlaying || currentSegmentIndex >= groupedSentences.length) {
    return;
  }

  // Check if next segment audio is ready
  while (!audioCache.has(currentSegmentIndex) && isTranslating) {
    // Pause and wait for buffer
    if (youtubeVideo) {
      youtubeVideo.pause();
    }
    document.getElementById('translation-status-text').textContent = 'Buffering...';
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  if (!audioCache.has(currentSegmentIndex)) {
    // No more segments
    isPlaying = false;
    document.getElementById('play-btn').style.display = 'flex';
    document.getElementById('pause-btn').style.display = 'none';
    return;
  }

  // Resume YouTube if paused
  if (youtubeVideo && youtubeVideo.paused) {
    youtubeVideo.play();
  }

  // Highlight current segment
  highlightSegment(currentSegmentIndex);

  // Play audio
  const audioBlob = audioCache.get(currentSegmentIndex);
  const audioURL = URL.createObjectURL(audioBlob);
  currentAudio = new Audio(audioURL);

  currentAudio.play();

  // Wait for audio to finish
  await new Promise((resolve) => {
    currentAudio.onended = () => {
      URL.revokeObjectURL(audioURL);
      currentSegmentIndex++;
      resolve();
    };

    currentAudio.onerror = () => {
      console.error(`Error playing audio for segment ${currentSegmentIndex}`);
      URL.revokeObjectURL(audioURL);
      currentSegmentIndex++;
      resolve();
    };
  });

  // Continue to next segment
  await playNextSegment();
}

function highlightSegment(index) {
  // Remove previous highlights
  document.querySelectorAll('.translation-item').forEach(item => {
    item.classList.remove('active');
  });

  // Highlight current
  const currentItem = document.querySelector(`.translation-item[data-index="${index}"]`);
  if (currentItem) {
    currentItem.classList.add('active');
    currentItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function pausePlayback() {
  isPlaying = false;
  if (currentAudio) {
    currentAudio.pause();
  }
  if (youtubeVideo) {
    youtubeVideo.pause();
  }

  document.getElementById('play-btn').style.display = 'flex';
  document.getElementById('pause-btn').style.display = 'none';
}

function resumePlayback() {
  isPlaying = true;
  if (currentAudio) {
    currentAudio.play();
  }
  if (youtubeVideo) {
    youtubeVideo.muted = true;
    youtubeVideo.play();
  }

  document.getElementById('play-btn').style.display = 'none';
  document.getElementById('pause-btn').style.display = 'flex';

  if (!currentAudio) {
    playNextSegment();
  }
}

function formatTime(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Q&A functions
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
      throw new Error('Failed to get answer');
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

// Message listener
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

// Video change detection
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

    // Reset state
    translations.clear();
    audioCache.clear();
    isTranslating = false;
    isPlaying = false;
    hasAutoStarted = false;
    currentSegmentIndex = 0;
    playbackQueue = [];

    if ((settings.enableQA && settings.geminiApiKey) ||
        (settings.enableTranslation && settings.targetLanguage)) {
      loadVideoFeatures();
    }
  }
}, 1000);

init();
