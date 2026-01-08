# Audio Playback Fix - Web Audio API Implementation

## Issue
Translated audio was being generated successfully (valid MP3 blobs, correct duration) but was playing silently. User could not hear the dubbed audio despite all technical indicators showing playback was working.

## Root Cause
Chrome's audio routing was getting confused when the video element was muted (`video.muted = true`). This caused all tab audio, including the translated TTS audio, to be silently routed.

## Solution
Implemented Web Audio API approach with proper audio routing:

1. **Lower video volume instead of muting** - Changed from `video.muted = true` to `video.volume = 0.01`
2. **Use Web Audio API for playback** - Proper audio graph routing ensures audio goes to speakers
3. **Handle AudioContext state** - Resume if suspended due to Chrome's autoplay policy

## Changes Made

### 1. Added Web Audio API Variables
**Location**: [content-autoplay.js:51-53](content/content-autoplay.js#L51-L53)

```javascript
// Web Audio API for reliable audio playback
let audioContextForPlayback = null;
let originalVideoVolume = 1.0;
```

### 2. Updated Tab Capture Start Handler
**Location**: [content-autoplay.js:285-311](content/content-autoplay.js#L285-L311)

**Before**:
```javascript
video.muted = true;
```

**After**:
```javascript
// Save original volume and lower to near-zero
originalVideoVolume = video.volume;
video.volume = 0.01;

// Initialize AudioContext
if (!audioContextForPlayback) {
  audioContextForPlayback = new (window.AudioContext || window.webkitAudioContext)();
}
```

**Why**: Lowering volume instead of muting keeps Chrome's audio routing active, allowing translated audio to play.

### 3. Updated Tab Capture Stop Handler
**Location**: [content-autoplay.js:313-337](content/content-autoplay.js#L313-L337)

**Before**:
```javascript
video.muted = false;
```

**After**:
```javascript
// Restore original volume
video.volume = originalVideoVolume;

// Stop currently playing audio and clear queue
if (currentPlayingAudio) {
  currentPlayingAudio.pause();
  currentPlayingAudio = null;
}
audioQueue = [];
isPlayingAudio = false;
```

**Why**: Properly restore original state and cleanup audio resources.

### 4. Rewrote playNextAudio() with Web Audio API
**Location**: [content-autoplay.js:351-434](content/content-autoplay.js#L351-L434)

**Key Implementation**:
```javascript
async function playNextAudio() {
  // Create/resume AudioContext
  if (!audioContextForPlayback) {
    audioContextForPlayback = new (window.AudioContext || window.webkitAudioContext)();
  }

  if (audioContextForPlayback.state === 'suspended') {
    await audioContextForPlayback.resume();
  }

  // Create audio element from blob
  const audio = new Audio(URL.createObjectURL(audioData.blob));

  // Connect to AudioContext with gain control
  const source = audioContextForPlayback.createMediaElementSource(audio);
  const gainNode = audioContextForPlayback.createGain();
  gainNode.gain.value = 1.0; // Maximum volume

  // Route: source -> gain -> speakers
  source.connect(gainNode);
  gainNode.connect(audioContextForPlayback.destination);

  await audio.play();
}
```

**Audio Graph**:
```
MP3 Blob → Audio Element → MediaElementSource → GainNode → AudioDestination → Speakers
```

**Why**:
- `createMediaElementSource()` properly routes audio through Web Audio API
- `GainNode` provides volume control
- Connection to `audioContext.destination` ensures audio goes to system speakers
- Handles Chrome autoplay policy by resuming suspended AudioContext

## Technical Details

### Chrome Audio Routing
When `video.muted = true`:
- Chrome routes **all** tab audio to silence
- Even separate Audio elements get silenced
- Tab shows audio playing icon, but nothing is audible

When `video.volume = 0.01`:
- Audio routing stays active
- Web Audio API can play through speakers
- User hears translated audio at full volume (via GainNode)
- Original video audio barely audible (1% volume)

### Web Audio API Benefits
1. **Explicit audio routing** - Direct control over where audio goes
2. **Bypass limitations** - Not affected by video element state
3. **Better control** - Volume, effects, mixing capabilities
4. **Handles autoplay policy** - Can resume suspended contexts

### Autoplay Policy Handling
Chrome suspends AudioContext until user interaction. Our implementation:
1. Creates AudioContext on user click (Start Translation button)
2. Checks `audioContextForPlayback.state`
3. Resumes if suspended: `await audioContextForPlayback.resume()`

## Testing

### Expected Behavior
1. Click "Start Translation" in popup
2. Original Netflix audio drops to 1% volume
3. Translated Hindi audio plays at full volume through speakers
4. User hears dubbed audio clearly
5. Click "Stop Translation" → original audio restored

### Console Logs to Verify
```
✅ Tab capture started successfully
🔉 Original video volume lowered to 0.01 (was 1.0)
🎵 AudioContext created for translated audio playback
🔊 Playing translated audio: "धन्यवाद।..."
   Audio blob size: 6.94 KB
   Audio blob type: audio/mpeg
🎵 AudioContext created
🔌 Audio connected to AudioContext (source -> gain -> speakers)
   Audio duration: 0.89 seconds
▶️ Audio playback started via AudioContext
✅ Audio playback finished
```

### Debugging
If still no audio:
1. Check system volume/mute
2. Check Chrome site permissions (not blocking audio)
3. Check `chrome://media-internals` for active audio streams
4. Verify AudioContext state: `audioContextForPlayback.state` should be "running"

## Files Modified
- [content/content-autoplay.js](content/content-autoplay.js) - Web Audio API implementation

## Next Steps (Optional Improvements)
1. **Audio ducking** - Dynamically adjust video volume based on speech
2. **Cross-fade** - Smooth transitions between audio chunks
3. **Equalizer** - Enhance voice clarity
4. **Spatial audio** - Position voices in stereo field

---

**Date**: 2026-01-07
**Status**: Audio playback fix implemented with Web Audio API
**Ready for testing**: Yes
