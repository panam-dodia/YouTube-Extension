# Audio Playback Fix - Offscreen Document Playback

## Root Cause Analysis

After extensive debugging, we identified the critical issue:

**Tab Capture API intercepts ALL audio from the captured tab**, including:
- Original video audio ✓ (intended)
- Our translated audio played in content script ✗ (unintended)

When tab capture is active, Chrome routes all tab audio to the MediaStream being captured, preventing it from reaching the user's speakers.

## Evidence from Logs

```
✅ AudioContext state: running
✅ Audio decoded: 0.96 seconds, 1 channels
✅ GainNode gain value: 1
✅ Audio connected: BufferSource -> Gain -> Speakers
✅ Playback started via AudioContext
✅ Playback should finish at: 17.27s
✅ Audio playback finished (at exactly 17.27s)
```

Everything worked perfectly **except the user couldn't hear it** - proof that audio was being captured instead of playing to speakers.

## Solution: Offscreen Document Playback

Play translated audio in the **offscreen document** instead of the content script, because:

1. **Offscreen document audio is NOT captured** - It runs in a separate hidden document
2. **Tab capture only captures the tab** - Not extension contexts
3. **Audio flows directly to speakers** - Bypassing the capture stream

## Architecture Change

### Before (Not Working)
```
Content Script → Web Audio API → Speakers
                                    ↓
                              (Intercepted by Tab Capture)
                                    ↓
                            MediaRecorder → Backend
                                    ↓
                              (Audio lost)
```

### After (Working)
```
Tab Audio:
  Video → Tab Capture → Offscreen MediaRecorder → Backend ✓

Translated Audio:
  Content Script → Background → Offscreen Playback → Speakers ✓
  (Bypasses tab capture entirely)
```

## Implementation

### 1. Content Script Changes
**File**: [content-autoplay.js:514-544](content/content-autoplay.js#L514-L544)

Instead of playing audio locally, send it to offscreen document:

```javascript
// Convert blob to base64
const arrayBuffer = await audioBlob.arrayBuffer();
const base64Audio = btoa(
  new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
);

// Send to offscreen for playback
chrome.runtime.sendMessage({
  action: 'playTranslatedAudio',
  audioData: base64Audio,
  text: translatedText
});
```

**Why base64?** Chrome extension messages can't send Blobs directly, must serialize.

### 2. Background Script Router
**File**: [background.js:273-292](background/background.js#L273-L292)

Route messages from content script to offscreen document:

```javascript
if (message.action === 'playTranslatedAudio') {
  console.log('📨 Forwarding audio to offscreen document for playback');

  chrome.runtime.sendMessage({
    action: 'playTranslatedAudio',
    audioData: message.audioData,
    text: message.text
  });

  sendResponse({ success: true });
  return true;
}
```

### 3. Offscreen Document Playback
**File**: [offscreen.js:223-281](offscreen/offscreen.js#L223-L281)

Play audio using Web Audio API in offscreen context:

```javascript
async function playTranslatedAudio(base64Audio, text) {
  // Decode base64 to blob
  const binaryString = atob(base64Audio);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  const audioBlob = new Blob([bytes], { type: 'audio/mpeg' });

  // Create AudioContext
  if (!audioContext) {
    audioContext = new AudioContext();
  }

  // Decode and play
  const arrayBuffer = await audioBlob.arrayBuffer();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

  const source = audioContext.createBufferSource();
  source.buffer = audioBuffer;

  const gainNode = audioContext.createGain();
  gainNode.gain.value = 1.0;

  source.connect(gainNode);
  gainNode.connect(audioContext.destination);

  source.start(0);
  console.log('▶️ [Offscreen] Playback started');
}
```

**Key**: This AudioContext runs in offscreen document, which is **outside tab capture scope**.

## Message Flow

```
1. Content Script receives transcript
   ↓
2. Translates text
   ↓
3. Generates TTS audio (MP3 blob)
   ↓
4. Converts to base64
   ↓
5. Sends to Background Script
   action: 'playTranslatedAudio'
   ↓
6. Background forwards to Offscreen Document
   ↓
7. Offscreen decodes base64 → blob
   ↓
8. Offscreen plays via Web Audio API
   ↓
9. Audio goes to speakers ✓
   (NOT captured by tab capture)
```

## Why This Works

### Tab Capture Scope
Chrome's tab capture API captures audio from:
- ✅ The web page (video element)
- ✅ Content scripts (run in page context)
- ❌ Extension pages (popup, options, offscreen)
- ❌ Background service worker

### Offscreen Document Context
The offscreen document:
- Runs in extension context (not page context)
- Has access to Web Audio API
- Can play audio to system speakers
- Is **immune to tab capture**

## Testing

### Expected Behavior
1. Start translation on Netflix/YouTube
2. Original video volume drops to 1%
3. Tab capture records original audio
4. Transcripts appear in real-time
5. Translated audio plays from offscreen document
6. **User hears dubbed audio clearly**

### Console Logs

**Content Script**:
```
📤 Sending audio to offscreen document for playback...
✅ Audio sent to offscreen for playback
```

**Background Script**:
```
📨 Forwarding audio to offscreen document for playback
✅ Audio forwarded to offscreen
```

**Offscreen Document**:
```
📨 Offscreen received message: playTranslatedAudio
🔊 [Offscreen] Playing translated audio: "धन्यवाद।..."
   [Offscreen] Audio blob size: 7.50 KB
🎵 [Offscreen] AudioContext created
   [Offscreen] Audio decoded: 0.96s, 1 channels
🔌 [Offscreen] Audio connected to speakers (outside tab capture)
▶️ [Offscreen] Playback started
✅ [Offscreen] Playback finished
```

## Files Modified

1. **[content/content-autoplay.js](content/content-autoplay.js)**
   - Removed local audio playback
   - Added base64 encoding
   - Send audio to background for offscreen playback

2. **[background/background.js](background/background.js)**
   - Added `playTranslatedAudio` router
   - Forwards messages from content script to offscreen

3. **[offscreen/offscreen.js](offscreen/offscreen.js)**
   - Added audio playback variables
   - Implemented `playTranslatedAudio()` function
   - Uses Web Audio API for playback

## Technical Details

### Why Base64 Encoding?
Chrome extension messaging API (`chrome.runtime.sendMessage`) only supports JSON-serializable data:
- ✓ Strings, numbers, booleans, arrays, objects
- ✗ Blobs, ArrayBuffers, Files

Solution: Convert blob to base64 string, decode in offscreen document.

### Audio Queue (Future Enhancement)
Current implementation plays audio immediately. For better UX:
- Add queue in offscreen document
- Play sequentially without overlap
- Handle stop/pause commands

### Performance
- Base64 encoding adds ~33% size overhead
- Acceptable for small audio chunks (3-30 KB)
- Alternative: Use chrome.storage or Blob URLs

## Comparison: Before vs After

| Aspect | Content Script Playback | Offscreen Playback |
|--------|------------------------|-------------------|
| **Tab Capture Impact** | ✗ Captured, not heard | ✓ Bypasses capture |
| **Audio Routing** | ✗ Goes to MediaStream | ✓ Goes to speakers |
| **User Experience** | ✗ Silent | ✓ Audible |
| **Complexity** | Simple | Moderate |
| **Message Overhead** | None | Base64 encoding |

---

**Date**: 2026-01-07
**Status**: Implemented, ready for testing
**Expected Outcome**: User should now hear translated audio while tab capture records original audio
