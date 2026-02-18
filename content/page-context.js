// This script runs in the MAIN world (page's JS context)
// It extracts caption track URLs from YouTube's player data
// and sends them to the content script for background-fetched retrieval.
//
// Strategy:
//   1. Extract captionTracks from ytInitialPlayerResponse / movie_player
//   2. Send URLs back to content script (which routes through background service worker)
//   3. If no caption tracks found, signal DOM capture mode

window.addEventListener('message', async (event) => {
  if (event.source !== window) return;

  if (event.data?.type === 'TB_GET_TRANSCRIPT') {
    const videoId = event.data.videoId;
    console.log('TalkBridge MAIN: Getting caption info for', videoId);

    try {
      const captionInfo = await extractCaptionInfo(videoId);

      if (captionInfo.tracks && captionInfo.tracks.length > 0) {
        console.log('TalkBridge MAIN: Found', captionInfo.tracks.length, 'caption tracks');
        window.postMessage({
          type: 'TB_CAPTION_TRACKS',
          tracks: captionInfo.tracks,
          videoId: videoId
        }, '*');
      } else {
        console.log('TalkBridge MAIN: No caption tracks found, signaling DOM capture');
        window.postMessage({
          type: 'TB_CAPTION_TRACKS',
          tracks: [],
          videoId: videoId,
          error: 'No caption tracks found'
        }, '*');
      }
    } catch (e) {
      console.error('TalkBridge MAIN: Error extracting caption info:', e);
      window.postMessage({
        type: 'TB_CAPTION_TRACKS',
        tracks: [],
        videoId: videoId,
        error: e.message
      }, '*');
    }
  }

  if (event.data?.type === 'TB_START_DOM_CAPTURE') {
    startDomCaptionCapture(event.data.videoId);
  }

  if (event.data?.type === 'TB_STOP_DOM_CAPTURE') {
    stopDomCaptionCapture();
  }
});

// ============================================================
// Extract caption track info from YouTube's player response
// ============================================================
async function extractCaptionInfo(videoId) {
  const maxRetries = 8;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    console.log('TalkBridge MAIN: Attempt', attempt + 1, 'to get caption tracks...');

    // Try ytInitialPlayerResponse
    if (window.ytInitialPlayerResponse?.videoDetails?.videoId === videoId) {
      const tracks = window.ytInitialPlayerResponse?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
      if (tracks && tracks.length > 0) {
        console.log('TalkBridge MAIN: Found tracks via ytInitialPlayerResponse');
        return buildTrackInfo(tracks);
      }
    }

    // Try movie_player.getPlayerResponse()
    const player = document.getElementById('movie_player');
    if (player?.getPlayerResponse) {
      const resp = player.getPlayerResponse();
      if (resp?.videoDetails?.videoId === videoId) {
        const tracks = resp?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        if (tracks && tracks.length > 0) {
          console.log('TalkBridge MAIN: Found tracks via movie_player');
          return buildTrackInfo(tracks);
        }
      }
    }

    // Try ytplayer.config
    if (window.ytplayer?.config?.args?.raw_player_response) {
      const rawResp = window.ytplayer.config.args.raw_player_response;
      if (rawResp?.videoDetails?.videoId === videoId) {
        const tracks = rawResp?.captions?.playerCaptionsTracklistRenderer?.captionTracks;
        if (tracks && tracks.length > 0) {
          console.log('TalkBridge MAIN: Found tracks via ytplayer.config');
          return buildTrackInfo(tracks);
        }
      }
    }

    if (attempt < maxRetries - 1) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  return { tracks: [] };
}

function buildTrackInfo(captionTracks) {
  const tracks = captionTracks.map(track => ({
    baseUrl: track.baseUrl,
    languageCode: track.languageCode,
    name: track.name?.simpleText || track.name?.runs?.[0]?.text || '',
    kind: track.kind || '',
    isTranslatable: track.isTranslatable || false,
    vssId: track.vssId || ''
  }));

  // Sort: prefer English, then manual captions over ASR
  tracks.sort((a, b) => {
    const aEn = a.languageCode === 'en' || a.languageCode?.startsWith('en') ? 0 : 1;
    const bEn = b.languageCode === 'en' || b.languageCode?.startsWith('en') ? 0 : 1;
    if (aEn !== bEn) return aEn - bEn;
    const aAsr = a.kind === 'asr' ? 1 : 0;
    const bAsr = b.kind === 'asr' ? 1 : 0;
    return aAsr - bAsr;
  });

  return { tracks };
}

// ============================================================
// DOM caption capture (Tier 3 fallback)
// ============================================================
let domCaptureObserver = null;
let domCaptureSegments = [];
let captionContainerWatcher = null;
let domCaptureActive = false;
let lastCaptionText = '';
let captionDebounceTimer = null;

function isAdPlaying() {
  // Check for YouTube ad indicators
  // Note: .video-ads always exists on YouTube, so we must NOT use it
  const player = document.querySelector('.html5-video-player');
  if (player && player.classList.contains('ad-showing')) {
    return true;
  }
  // Check for ad overlay that only appears during actual ads
  const adOverlay = document.querySelector('.ytp-ad-player-overlay');
  return !!adOverlay;
}

function startDomCaptionCapture(videoId) {
  stopDomCaptionCapture();
  domCaptureSegments = [];
  domCaptureActive = true;

  console.log('TalkBridge MAIN: Starting DOM caption capture for', videoId);

  // Enable captions
  enableCaptions();

  // Start a persistent watcher that continuously looks for caption containers
  // This handles ad→video transitions where the container is destroyed and recreated
  startCaptionContainerWatcher();
}

function enableCaptions() {
  const player = document.getElementById('movie_player');

  // Try player API to enable captions
  if (player) {
    try {
      if (player.getOption && player.setOption) {
        const tracklist = player.getOption('captions', 'tracklist');
        console.log('TalkBridge MAIN: Caption tracklist:', tracklist ? tracklist.length + ' tracks' : 'null');
        if (tracklist && tracklist.length > 0) {
          player.setOption('captions', 'track', tracklist[0]);
          console.log('TalkBridge MAIN: Enabled caption track via API');
        }
      }
    } catch (e) {
      console.log('TalkBridge MAIN: player.setOption failed:', e.message);
    }
  }

  // Click the CC button to toggle captions on
  const ccButton = document.querySelector('.ytp-subtitles-button');
  if (ccButton) {
    const isPressed = ccButton.getAttribute('aria-pressed');
    console.log('TalkBridge MAIN: CC button found, aria-pressed:', isPressed);
    if (isPressed === 'false') {
      ccButton.click();
      console.log('TalkBridge MAIN: Clicked CC button to enable captions');
    }
  } else {
    console.log('TalkBridge MAIN: No CC button found');
  }
}

function startCaptionContainerWatcher() {
  // Stop existing watcher
  if (captionContainerWatcher) {
    clearInterval(captionContainerWatcher);
  }

  let currentContainer = null;

  // Check every 2 seconds for caption container changes
  // This handles: initial load, ad→video transitions, container recreation
  captionContainerWatcher = setInterval(() => {
    if (!domCaptureActive) {
      clearInterval(captionContainerWatcher);
      captionContainerWatcher = null;
      return;
    }

    const container = document.querySelector('.ytp-caption-window-container');

    if (container && container !== currentContainer) {
      // New or changed container detected
      console.log('TalkBridge MAIN: Caption container detected/changed, setting up observer');
      currentContainer = container;

      // Re-enable captions (might need re-enabling after ad)
      enableCaptions();

      // Set up observer on the new container
      if (domCaptureObserver) {
        domCaptureObserver.disconnect();
      }
      observeCaptionContainer(container);
    } else if (!container && currentContainer) {
      // Container was removed (ad transition)
      console.log('TalkBridge MAIN: Caption container removed (likely ad transition), waiting for new one...');
      currentContainer = null;
      if (domCaptureObserver) {
        domCaptureObserver.disconnect();
        domCaptureObserver = null;
      }
    }
  }, 2000);

  // Also do an immediate check
  setTimeout(() => {
    const container = document.querySelector('.ytp-caption-window-container');
    if (container) {
      console.log('TalkBridge MAIN: Caption container found immediately');
      observeCaptionContainer(container);
    } else {
      console.log('TalkBridge MAIN: No caption container yet, watcher will keep checking...');
    }
  }, 1500);
}

function observeCaptionContainer(captionContainer) {
  // Disconnect previous observer
  if (domCaptureObserver) {
    domCaptureObserver.disconnect();
  }

  let lastSentText = '';  // Last text we actually sent
  let pendingText = '';   // Text waiting to be sent (in debounce)
  let pendingTime = 0;    // Timestamp when pending text was captured
  let debounceTimer = null;

  function sendSegment(text, time) {
    if (!text || text.length < 3) return;
    if (isAdPlaying()) return;

    // Deduplicate against last sent
    if (text === lastSentText) return;

    lastSentText = text;
    const segment = { text: text, start: time, duration: 3 };
    domCaptureSegments.push(segment);

    console.log('TalkBridge MAIN: Caption segment:', text);

    window.postMessage({
      type: 'TB_DOM_CAPTION_SEGMENT',
      segment: segment
    }, '*');
  }

  function isTextExtending(oldText, newText) {
    // Check if newText is just oldText with more words appended
    if (!oldText) return false;
    return newText.startsWith(oldText);
  }

  function hasOverlap(oldText, newText) {
    // Check if end of oldText overlaps with start of newText (sliding window)
    if (!oldText) return false;
    const oldWords = oldText.split(/\s+/);
    for (let i = 1; i < oldWords.length; i++) {
      const suffix = oldWords.slice(i).join(' ');
      if (newText.startsWith(suffix)) return true;
    }
    return false;
  }

  domCaptureObserver = new MutationObserver(() => {
    // Skip captions during ads
    if (isAdPlaying()) return;

    const captionSegments = captionContainer.querySelectorAll('.ytp-caption-segment');
    if (!captionSegments || captionSegments.length === 0) return;

    const currentText = Array.from(captionSegments).map(s => s.textContent).join(' ').trim();
    if (!currentText || currentText === lastCaptionText) return;

    // Filter out YouTube UI text
    if (currentText.includes('(auto-generated)') || currentText.includes('for settings')) return;

    lastCaptionText = currentText;

    const video = document.querySelector('video');
    const currentTime = video ? video.currentTime : 0;

    // Determine if this is the same caption line growing, or a completely new line
    const extending = isTextExtending(pendingText, currentText);
    const overlapping = !extending && hasOverlap(pendingText, currentText);
    const isNewLine = !extending && !overlapping && pendingText && currentText !== pendingText;

    if (isNewLine) {
      // YouTube switched to a completely new caption line.
      // FLUSH the pending text immediately - don't let it get lost!
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      sendSegment(pendingText, pendingTime);
    }

    // Update pending with current text
    pendingText = currentText;
    pendingTime = currentTime;

    // Set debounce to send the text after it stops changing
    // Shorter wait if sentence looks complete (ends with punctuation)
    const endsWithPunctuation = /[।?!.\u0964]$/.test(currentText.trim());
    const debounceMs = endsWithPunctuation ? 400 : 800;

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (pendingText) {
        sendSegment(pendingText, pendingTime);
        pendingText = '';
      }
    }, debounceMs);
  });

  domCaptureObserver.observe(captionContainer, {
    childList: true,
    subtree: true,
    characterData: true
  });

  console.log('TalkBridge MAIN: DOM caption observer started');
  window.postMessage({ type: 'TB_DOM_CAPTURE_STATUS', status: 'started' }, '*');
}

function stopDomCaptionCapture() {
  domCaptureActive = false;
  if (domCaptureObserver) {
    domCaptureObserver.disconnect();
    domCaptureObserver = null;
  }
  if (captionContainerWatcher) {
    clearInterval(captionContainerWatcher);
    captionContainerWatcher = null;
  }
  if (captionDebounceTimer) {
    clearTimeout(captionDebounceTimer);
    captionDebounceTimer = null;
  }
  lastCaptionText = '';
  console.log('TalkBridge MAIN: DOM caption capture stopped, captured', domCaptureSegments.length, 'segments');
  domCaptureSegments = [];
}
