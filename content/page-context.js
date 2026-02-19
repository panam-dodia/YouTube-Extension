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
    startDomCaptionCapture(event.data.videoId, event.data.sourceLang || null, event.data.sourceVssId || null);
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

  // Sort: manual captions before ASR, no language preference
  // (we want the original-language track, not English auto-translate)
  tracks.sort((a, b) => {
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
let captionHideStyle = null;
let captureSourceLang = null;
let captureSourceVssId = null;

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

function startDomCaptionCapture(videoId, sourceLang, sourceVssId) {
  stopDomCaptionCapture();
  domCaptureSegments = [];
  domCaptureActive = true;
  captureSourceLang = sourceLang || null;
  captureSourceVssId = sourceVssId || null;

  console.log('TalkBridge MAIN: Starting DOM caption capture for', videoId, 'sourceLang:', captureSourceLang, 'vssId:', captureSourceVssId);

  // Enable captions (needed for DOM to be populated), but hide them visually
  enableCaptions(captureSourceLang, captureSourceVssId);
  hideCaptionsVisually();

  // Start a persistent watcher that continuously looks for caption containers
  // This handles ad→video transitions where the container is destroyed and recreated
  startCaptionContainerWatcher();
}

function enableCaptions(sourceLang, sourceVssId) {
  const player = document.getElementById('movie_player');

  // Step 1: Select the right caption track (vssId is most direct)
  if (player && player.setOption && sourceVssId) {
    try {
      player.setOption('captions', 'track', { vssId: sourceVssId });
      console.log('TalkBridge MAIN: Set caption track via vssId:', sourceVssId);
    } catch (e) {
      console.log('TalkBridge MAIN: vssId track set failed:', e.message);
    }
  } else if (player && player.getOption && player.setOption) {
    try {
      const tracklist = player.getOption('captions', 'tracklist');
      console.log('TalkBridge MAIN: Caption tracklist:', tracklist ? tracklist.length + ' tracks' : 'null');
      if (tracklist && tracklist.length > 0) {
        const track = sourceLang
          ? (tracklist.find(t => t.languageCode === sourceLang) || tracklist[0])
          : tracklist[0];
        player.setOption('captions', 'track', track);
        console.log('TalkBridge MAIN: Set caption track via tracklist:', track.languageCode);
      }
    } catch (e) {
      console.log('TalkBridge MAIN: tracklist API failed:', e.message);
    }
  }

  // Step 2: Always ensure CC button is ON — setOption alone may not enable it
  const ccButton = document.querySelector('.ytp-subtitles-button');
  if (ccButton) {
    const isPressed = ccButton.getAttribute('aria-pressed');
    console.log('TalkBridge MAIN: CC button aria-pressed:', isPressed);
    if (isPressed === 'false') {
      ccButton.click();
      console.log('TalkBridge MAIN: Clicked CC button to enable captions');

      // After CC is enabled, re-apply the track (clicking CC may revert to default language)
      if (player && (sourceVssId || sourceLang)) {
        setTimeout(() => {
          try {
            if (sourceVssId) {
              player.setOption('captions', 'track', { vssId: sourceVssId });
              console.log('TalkBridge MAIN: Re-applied vssId after CC enable:', sourceVssId);
            } else {
              const tracklist = player.getOption('captions', 'tracklist');
              if (tracklist && tracklist.length > 0) {
                const track = tracklist.find(t => t.languageCode === sourceLang) || tracklist[0];
                player.setOption('captions', 'track', track);
                console.log('TalkBridge MAIN: Re-applied language track after CC enable:', track.languageCode);
              }
            }
          } catch (e) {}
        }, 600);
      }
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
      enableCaptions(captureSourceLang, captureSourceVssId);

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
  if (domCaptureObserver) {
    domCaptureObserver.disconnect();
  }

  // lastWindowText: the full text of the last DOM capture (the sliding window)
  // accumulated: new words we've extracted but not yet sent
  // segmentStartTime: when the current accumulated chunk started
  let lastWindowText = '';
  let accumulated = '';
  let segmentStartTime = 0;
  let flushTimer = null;

  // Extract only the NEW words from curr that weren't in prev.
  // YouTube shows a sliding window: end of prev overlaps with start of curr.
  // e.g. prev="A B C D E", curr="C D E F G" → new part is "F G"
  function extractNew(prev, curr) {
    if (!prev) return curr;
    if (curr === prev) return '';

    // Case 1: curr is just prev growing (more words at end)
    if (curr.startsWith(prev)) {
      return curr.slice(prev.length).trim();
    }

    // Case 2: two-line caption — YouTube stacks old line above new line with double-space.
    // e.g. prev="X.", curr="X.  Y." → new content is "Y."
    // Take the LAST segment after any double-space, then recursively extract new from it.
    if (curr.includes('  ')) {
      const parts = curr.split(/\s{2,}/);
      const lastPart = parts[parts.length - 1].trim();
      if (lastPart && lastPart !== prev) {
        return extractNew(prev, lastPart);
      }
    }

    // Case 3: prev is embedded somewhere inside curr (window expanded backwards).
    // Return everything that comes after prev in curr.
    const embeddedIdx = curr.indexOf(prev);
    if (embeddedIdx !== -1) {
      return curr.slice(embeddedIdx + prev.length).trim();
    }

    // Case 4: sliding window — find longest suffix of prev that is a prefix of curr
    const prevWords = prev.split(/\s+/);
    for (let i = 1; i < prevWords.length; i++) {
      const suffix = prevWords.slice(i).join(' ');
      if (suffix.length > 4 && curr.startsWith(suffix)) {
        return curr.slice(suffix.length).trim();
      }
    }

    // Case 5: completely new line, no detectable overlap
    return curr;
  }

  let lastSentSegmentText = '';

  function sendSegment(text, time) {
    const clean = text.trim();
    if (!clean || clean.length < 5) return;
    if (isAdPlaying()) return;

    // Skip if same as last sent (ignoring trailing punctuation) — prevents double-send
    // when the period arrives just after a timeout-flush of the same words
    const normalize = t => t.replace(/[।?!.\u0964\s]+$/, '').trim().toLowerCase();
    if (normalize(clean) === normalize(lastSentSegmentText)) return;
    lastSentSegmentText = clean;

    lastCaptionText = clean;
    const segment = { text: clean, start: time, duration: 3 };
    domCaptureSegments.push(segment);

    console.log('TalkBridge MAIN: Caption segment:', clean);
    window.postMessage({ type: 'TB_DOM_CAPTION_SEGMENT', segment }, '*');
  }

  function flushAccumulated() {
    if (accumulated.trim().length >= 5) {
      sendSegment(accumulated, segmentStartTime);
    }
    accumulated = '';
  }

  domCaptureObserver = new MutationObserver(() => {
    if (isAdPlaying()) return;

    const captionSegments = captionContainer.querySelectorAll('.ytp-caption-segment');
    if (!captionSegments || captionSegments.length === 0) return;

    const currentText = Array.from(captionSegments).map(s => s.textContent).join(' ').trim();
    if (!currentText || currentText === lastCaptionText) return;
    if (currentText.includes('(auto-generated)') || currentText.includes('for settings')) return;

    lastCaptionText = currentText;

    const video = document.querySelector('video');
    const currentTime = video ? video.currentTime : 0;

    // Extract only the truly new words
    const newWords = extractNew(lastWindowText, currentText);
    lastWindowText = currentText;

    if (!newWords) return;

    // Start timing the segment when we first get new words
    if (!accumulated) segmentStartTime = currentTime;
    // If newWords is only punctuation, attach directly (no space) to avoid "text ."
    if (/^[।?!.\u0964]+$/.test(newWords.trim())) {
      accumulated = accumulated.trimEnd() + newWords.trim();
    } else {
      accumulated += (accumulated ? ' ' : '') + newWords;
    }

    // Flush immediately if we hit sentence-ending punctuation
    const endsWithPunctuation = /[।?!.\u0964]$/.test(accumulated.trim());
    if (endsWithPunctuation) {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      flushAccumulated();
      return;
    }

    // Otherwise wait a bit for more words before sending
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      flushAccumulated();
    }, 1200);
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
  showCaptionsVisually();
  console.log('TalkBridge MAIN: DOM caption capture stopped, captured', domCaptureSegments.length, 'segments');
  domCaptureSegments = [];
}

function hideCaptionsVisually() {
  if (captionHideStyle) return;
  captionHideStyle = document.createElement('style');
  captionHideStyle.id = 'tb-caption-hide';
  captionHideStyle.textContent = '.ytp-caption-window-container { opacity: 0 !important; }';
  document.head.appendChild(captionHideStyle);
  console.log('TalkBridge MAIN: Captions hidden visually');
}

function showCaptionsVisually() {
  if (captionHideStyle) {
    captionHideStyle.remove();
    captionHideStyle = null;
    console.log('TalkBridge MAIN: Captions restored');
  }
}
