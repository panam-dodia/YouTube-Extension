// This script runs in the MAIN world (page's JS context)
// It can access YouTube's JS variables and the player API
// Tiered transcript strategy:
//   Tier 1: get_transcript InnerTube endpoint (most reliable for ASR)
//   Tier 2: timedtext API via captionTracks baseUrl (works for manual captions)
//   Tier 3: DOM caption capture via MutationObserver (ultimate fallback)

let domCaptureObserver = null;
let domCaptureSegments = [];

window.addEventListener('message', async (event) => {
  if (event.source !== window) return;

  if (event.data?.type === 'TB_GET_TRANSCRIPT') {
    const videoId = event.data.videoId;
    console.log('TalkBridge MAIN: Getting transcript for', videoId);

    try {
      let segments = [];

      // Tier 1: get_transcript InnerTube endpoint
      segments = await fetchViaGetTranscript(videoId);
      if (segments.length > 0) {
        console.log('TalkBridge MAIN: Tier 1 (get_transcript) returned', segments.length, 'segments');
        window.postMessage({ type: 'TB_TRANSCRIPT_RESPONSE', segments: segments, language: 'auto', method: 'get_transcript' }, '*');
        return;
      }

      // Tier 2: timedtext API via captionTracks
      segments = await fetchViaTimedtext(videoId);
      if (segments.length > 0) {
        console.log('TalkBridge MAIN: Tier 2 (timedtext) returned', segments.length, 'segments');
        window.postMessage({ type: 'TB_TRANSCRIPT_RESPONSE', segments: segments, language: 'auto', method: 'timedtext' }, '*');
        return;
      }

      // Tier 3: Signal content script to use DOM caption capture
      console.log('TalkBridge MAIN: Tiers 1-2 failed, signaling DOM caption capture mode');
      window.postMessage({ type: 'TB_TRANSCRIPT_RESPONSE', segments: [], method: 'dom_capture', error: 'Tiers 1-2 returned no segments' }, '*');

    } catch (e) {
      console.error('TalkBridge MAIN: Error:', e);
      window.postMessage({ type: 'TB_TRANSCRIPT_RESPONSE', segments: [], error: e.message }, '*');
    }
  }

  // DOM caption capture: start observing
  if (event.data?.type === 'TB_START_DOM_CAPTURE') {
    startDomCaptionCapture(event.data.videoId);
  }

  // DOM caption capture: stop and return collected segments
  if (event.data?.type === 'TB_STOP_DOM_CAPTURE') {
    stopDomCaptionCapture();
  }
});

// ============================================================
// Tier 1: get_transcript InnerTube endpoint
// ============================================================
async function fetchViaGetTranscript(videoId) {
  try {
    console.log('TalkBridge MAIN: Tier 1 - trying get_transcript endpoint...');

    // Build protobuf params: field1=videoId, field2=language, field3=flag
    const params = generateTranscriptParams(videoId, 'en');

    const response = await fetch('https://www.youtube.com/youtubei/v1/get_transcript', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Youtube-Client-Name': '3',
        'X-Youtube-Client-Version': '19.45.4'
      },
      body: JSON.stringify({
        context: {
          client: {
            hl: 'en',
            gl: 'US',
            clientName: 'IOS',
            clientVersion: '19.45.4',
            deviceModel: 'iPhone16,2',
            userAgent: 'com.google.ios.youtube/19.45.4 (iPhone16,2; U; CPU iOS 18_1_0 like Mac OS X)',
            timeZone: 'UTC'
          }
        },
        params: params
      })
    });

    if (!response.ok) {
      console.log('TalkBridge MAIN: get_transcript returned status', response.status);
      // Log response body for debugging
      try {
        const errText = await response.text();
        console.log('TalkBridge MAIN: get_transcript error body:', errText.substring(0, 300));
      } catch (e) {}
      return [];
    }

    const data = await response.json();

    // Parse the get_transcript response format
    const segments = parseGetTranscriptResponse(data);
    console.log('TalkBridge MAIN: get_transcript parsed', segments.length, 'segments');
    return segments;

  } catch (e) {
    console.log('TalkBridge MAIN: get_transcript failed:', e.message);
    return [];
  }
}

function generateTranscriptParams(videoId, lang) {
  // Protobuf encoding for get_transcript endpoint
  // Structure: field1 (video_id string), field2 (language string), field3 (varint 1)
  const encoder = new TextEncoder();
  const videoIdBytes = encoder.encode(videoId);
  const langBytes = encoder.encode(lang || 'en');

  // Calculate total size
  const totalSize = (2 + videoIdBytes.length) + (2 + langBytes.length) + 2;
  const proto = new Uint8Array(totalSize);
  let offset = 0;

  // Field 1 (tag=0x0a): video_id (string, length-delimited)
  proto[offset++] = 0x0a;
  proto[offset++] = videoIdBytes.length;
  proto.set(videoIdBytes, offset);
  offset += videoIdBytes.length;

  // Field 2 (tag=0x12): language (string, length-delimited)
  proto[offset++] = 0x12;
  proto[offset++] = langBytes.length;
  proto.set(langBytes, offset);
  offset += langBytes.length;

  // Field 3 (tag=0x18): flag (varint = 1)
  proto[offset++] = 0x18;
  proto[offset++] = 0x01;

  // Base64 encode
  return btoa(String.fromCharCode(...proto));
}

function parseGetTranscriptResponse(data) {
  const segments = [];

  try {
    // Navigate the response structure
    const actions = data?.actions;
    if (!actions) return segments;

    for (const action of actions) {
      const panel = action?.updateEngagementPanelAction?.content?.transcriptRenderer;
      if (!panel) continue;

      const body = panel?.body?.transcriptBodyRenderer;
      if (!body) continue;

      const cueGroups = body?.cueGroups;
      if (!cueGroups) continue;

      for (const group of cueGroups) {
        const renderer = group?.transcriptCueGroupRenderer;
        if (!renderer?.cues) continue;

        for (const cue of renderer.cues) {
          const cueRenderer = cue?.transcriptCueRenderer;
          if (!cueRenderer) continue;

          const text = cueRenderer.cue?.simpleText || '';
          const startMs = parseInt(cueRenderer.startOffsetMs || '0', 10);
          const durationMs = parseInt(cueRenderer.durationMs || '0', 10);

          if (text.trim()) {
            segments.push({
              text: text.trim(),
              start: startMs / 1000,
              duration: durationMs / 1000
            });
          }
        }
      }
    }
  } catch (e) {
    console.error('TalkBridge MAIN: Error parsing get_transcript response:', e);
  }

  return segments;
}

// ============================================================
// Tier 2: timedtext API via captionTracks baseUrl
// ============================================================
async function fetchViaTimedtext(videoId) {
  try {
    console.log('TalkBridge MAIN: Tier 2 - trying timedtext API...');

    // Get caption tracks from player (with retries for SPA navigation)
    let captions = null;
    const maxRetries = 5;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      // Try ytInitialPlayerResponse
      if (window.ytInitialPlayerResponse) {
        const resp = window.ytInitialPlayerResponse;
        if (resp.videoDetails?.videoId === videoId) {
          captions = resp.captions?.playerCaptionsTracklistRenderer?.captionTracks || null;
          if (captions) break;
        }
      }

      // Try movie_player
      const player = document.getElementById('movie_player');
      if (player && player.getPlayerResponse) {
        const response = player.getPlayerResponse();
        if (response?.videoDetails?.videoId === videoId) {
          captions = response?.captions?.playerCaptionsTracklistRenderer?.captionTracks || null;
          if (captions) break;
        }
      }

      if (attempt < maxRetries - 1) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    if (!captions || captions.length === 0) {
      console.log('TalkBridge MAIN: No caption tracks found');
      return [];
    }

    console.log('TalkBridge MAIN: Found', captions.length, 'caption track(s)');

    const selectedTrack = captions.find(t =>
      t.languageCode === 'en' || (t.languageCode && t.languageCode.startsWith('en'))
    ) || captions[0];

    // Try fetching caption content (srv1, json3, raw)
    const formats = [
      { name: 'srv1', suffix: '&fmt=srv1' },
      { name: 'json3', suffix: '&fmt=json3' },
      { name: 'raw', suffix: '' }
    ];

    for (const fmt of formats) {
      const url = selectedTrack.baseUrl + fmt.suffix;
      const resp = await fetch(url);
      const text = await resp.text();

      if (text.length === 0) continue;

      // Try XML parse
      const parser = new DOMParser();
      const doc = parser.parseFromString(text, 'text/xml');
      const elements = doc.getElementsByTagName('text');
      if (elements.length > 0) {
        const segments = [];
        for (const el of elements) {
          segments.push({
            text: el.textContent,
            start: parseFloat(el.getAttribute('start')),
            duration: parseFloat(el.getAttribute('dur'))
          });
        }
        console.log('TalkBridge MAIN: timedtext', fmt.name, 'returned', segments.length, 'segments');
        return segments;
      }

      // Try JSON parse
      try {
        const jsonData = JSON.parse(text);
        if (jsonData.events) {
          const segments = [];
          for (const ev of jsonData.events) {
            if (ev.segs) {
              const t = ev.segs.map(s => s.utf8 || '').join('');
              if (t.trim()) {
                segments.push({
                  text: t.trim(),
                  start: (ev.tStartMs || 0) / 1000,
                  duration: (ev.dDurationMs || 0) / 1000
                });
              }
            }
          }
          if (segments.length > 0) {
            console.log('TalkBridge MAIN: timedtext', fmt.name, 'JSON returned', segments.length, 'segments');
            return segments;
          }
        }
      } catch (e) { /* not JSON */ }
    }

    console.log('TalkBridge MAIN: timedtext returned empty for all formats');
    return [];

  } catch (e) {
    console.log('TalkBridge MAIN: timedtext failed:', e.message);
    return [];
  }
}

// ============================================================
// Tier 3: DOM caption capture via MutationObserver
// ============================================================
function startDomCaptionCapture(videoId) {
  stopDomCaptionCapture(); // Clean up any existing observer
  domCaptureSegments = [];

  console.log('TalkBridge MAIN: Starting DOM caption capture for', videoId);

  // Enable captions on the player if not already showing
  const player = document.getElementById('movie_player');
  if (player) {
    // Try to enable captions
    if (player.getOption && player.setOption) {
      try {
        const tracklist = player.getOption('captions', 'tracklist');
        if (tracklist && tracklist.length > 0) {
          player.setOption('captions', 'track', tracklist[0]);
          console.log('TalkBridge MAIN: Enabled caption track:', tracklist[0].languageCode || 'unknown');
        }
      } catch (e) {
        console.log('TalkBridge MAIN: Could not enable captions programmatically:', e.message);
      }
    }
  }

  // Watch for caption DOM changes
  const captionContainer = document.querySelector('.ytp-caption-window-container') ||
                           document.querySelector('.caption-window');

  if (!captionContainer) {
    console.log('TalkBridge MAIN: No caption container found in DOM');
    window.postMessage({ type: 'TB_DOM_CAPTURE_STATUS', status: 'no_container' }, '*');
    return;
  }

  let lastText = '';

  domCaptureObserver = new MutationObserver(() => {
    const captionSegments = captionContainer.querySelectorAll('.ytp-caption-segment');
    if (captionSegments.length === 0) return;

    const currentText = Array.from(captionSegments).map(s => s.textContent).join(' ').trim();
    if (!currentText || currentText === lastText) return;
    lastText = currentText;

    const video = document.querySelector('video');
    const currentTime = video ? video.currentTime : 0;

    domCaptureSegments.push({
      text: currentText,
      start: currentTime,
      duration: 3 // Approximate duration
    });

    // Send each captured segment to the content script in real-time
    window.postMessage({
      type: 'TB_DOM_CAPTION_SEGMENT',
      segment: { text: currentText, start: currentTime, duration: 3 }
    }, '*');
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
  if (domCaptureObserver) {
    domCaptureObserver.disconnect();
    domCaptureObserver = null;
    console.log('TalkBridge MAIN: DOM caption observer stopped, captured', domCaptureSegments.length, 'segments');
  }
  domCaptureSegments = [];
}
