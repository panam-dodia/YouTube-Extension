// Offscreen document for tab audio capture
// This runs in a hidden document that can receive MediaStream from background script

console.log('📄 Offscreen document loaded');

let mediaRecorder = null;
let audioChunks = [];
let isCapturing = false;
let chunkDuration = 3000; // 3s chunks for more complete sentences (balance between latency and quality)
let currentLanguage = 'en';
let chunkInterval = null;
let mediaStream = null;

let captureMode = 'tab'; // 'tab' or 'desktop'
let smallChunkCount = 0;
let failedChucksBeforeFallback = 2;
let hasSwitchedToMicrophone = false;

// Audio playback queue for translated audio (not captured by tab capture)
let audioPlaybackQueue = [];
let isPlayingTranslatedAudio = false;
let audioContext = null;
let playedAudioTexts = new Set(); // Track played audio to prevent duplicates

// Listen for messages from background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('📨 Offscreen received message:', message.action);

  if (message.action === 'startCapture') {
    startCapture(message.stream, message.sourceLanguage, message.captureType);
    sendResponse({ success: true });
    return true;
  }

  if (message.action === 'stopCapture') {
    stopCapture();
    sendResponse({ success: true });
    return true;
  }

  if (message.action === 'playTranslatedAudio') {
    playTranslatedAudio(message.audioData, message.text);
    sendResponse({ success: true });
    return true;
  }
});

async function startCapture(streamId, sourceLanguage = 'en', captureType = 'tab') {
  try {
    console.log('🎬 Starting capture with streamId:', streamId);
    console.log('📹 Capture type:', captureType);
    currentLanguage = sourceLanguage;

    // Get media stream using the streamId
    const constraints = {
      audio: {
        mandatory: {
          chromeMediaSource: captureType === 'desktop' ? 'desktop' : 'tab',
          chromeMediaSourceId: streamId
        }
      }
    };

    mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
    console.log('✅ Got media stream in offscreen');

    // Diagnostic: Check audio tracks
    const audioTracks = mediaStream.getAudioTracks();
    console.log('🔍 Audio tracks:', audioTracks.length);
    if (audioTracks.length > 0) {
      const track = audioTracks[0];
      console.log('🔍 Track label:', track.label);
      console.log('🔍 Track enabled:', track.enabled);
      console.log('🔍 Track muted:', track.muted);
      console.log('🔍 Track readyState:', track.readyState);
      console.log('🔍 Track settings:', track.getSettings());
    }

    const audioContextForCapture = new (window.AudioContext || window.webkitAudioContext)();
    const tabSource = audioContextForCapture.createMediaStreamSource(mediaStream);
    
    const destination = audioContextForCapture.createMediaStreamDestination();

    tabSource.connect(destination);

    tabSource.connect(audioContextForCapture.destination); // Optional: connect to destination for monitoring
    console.log('✅ Audio routed: tab -> recording + speakers');

    // Create media recorder
    const options = {
      mimeType: 'audio/webm;codecs=opus',
      audioBitsPerSecond: 128000
    };

    mediaRecorder = new MediaRecorder(destination.stream, options);

    mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        audioChunks.push(event.data);
        console.log(`📦 Data chunk received: ${(event.data.size / 1024).toFixed(2)} KB`);
      }
    };

    mediaRecorder.onstop = async () => {
      if (audioChunks.length > 0) {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm;codecs=opus' });
        const sizeKB = audioBlob.size / 1024;
        console.log(`🎵 Audio chunk captured: ${sizeKB.toFixed(2)} KB (mode: ${captureMode})`);

        // Check if audio chunk is too small (likely silence)
        if (sizeKB < 5) {
          smallChunkCount++;
          console.log(`⚠️ Audio chunk too small (${smallChunkCount}/${failedChucksBeforeFallback}). Likely silence or system doesnt support audio loopback`);
          audioChunks = [];

          if (captureMode === 'tab' && smallChunkCount >= failedChucksBeforeFallback && !hasSwitchedToMicrophone) {
            console.log('⚠️ Tab audio capture not working. System may not support audio loopback.');
            hasSwitchedToMicrophone = true;

            // Notify user that tab capture isn't working and suggest desktop capture
            chrome.runtime.sendMessage({
              action: 'notifyTabCaptureNotWorking',
              message: 'Tab audio capture is not supported on this system. Please use desktop capture mode instead.'
            });

            // Stop the failed capture
            stopCapture();
            return;
          }

          // Restart MediaRecorder if still capturing
          if (isCapturing && mediaRecorder && mediaRecorder.state === 'inactive') {
            mediaRecorder.start();
          }
          return;
        }

        smallChunkCount = 0; // Reset counter on valid chunk
        audioChunks = [];

        // Send to transcription via content script
        await transcribeChunk(audioBlob);
      }

      // Restart MediaRecorder after processing if still capturing
      if (isCapturing && mediaRecorder && mediaRecorder.state === 'inactive') {
        audioChunks = [];
        mediaRecorder.start();
      }
    };

    // Start recording in chunks
    mediaRecorder.start();
    isCapturing = true;

    console.log('✅ MediaRecorder started');

    // Stop periodically to create chunks (MediaRecorder will auto-restart in onstop)
    chunkInterval = setInterval(() => {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
      }
    }, chunkDuration);

    console.log('🎤 Offscreen audio capture started successfully');
  } catch (error) {
    console.error('❌ Failed to start capture in offscreen:', error);
  }
}

function stopCapture() {
  console.log('🛑 Stopping offscreen audio capture...');
  isCapturing = false;

  // Clear chunk interval
  if (chunkInterval) {
    clearInterval(chunkInterval);
    chunkInterval = null;
  }

  // Stop media recorder
  if (mediaRecorder && mediaRecorder.state !== 'inactive') {
    mediaRecorder.stop();
  }

  // Stop all media stream tracks to release the tab capture
  if (mediaStream) {
    mediaStream.getTracks().forEach(track => {
      track.stop();
      console.log('🔇 Stopped track:', track.label);
    });
    mediaStream = null;
  }

  mediaRecorder = null;
  audioChunks = [];

  // Clear audio playback tracking
  audioPlaybackQueue = [];
  isPlayingTranslatedAudio = false;
  playedAudioTexts.clear();

  console.log('✅ Offscreen audio capture stopped successfully');
}

async function transcribeChunk(audioBlob) {
  try {
    console.log('📤 Sending audio chunk to backend for transcription...');

    // Convert blob to base64
    const arrayBuffer = await audioBlob.arrayBuffer();
    const base64Audio = btoa(
      new Uint8Array(arrayBuffer).reduce((data, byte) => data + String.fromCharCode(byte), '')
    );

    console.log(`📊 Base64 audio size: ${(base64Audio.length / 1024).toFixed(2)} KB`);

    // Send to backend for transcription
    const response = await fetch('https://talkbridge-backend-1053199504066.us-central1.run.app/api/translation/speech-to-text', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audioData: base64Audio,
        sourceLanguage: currentLanguage
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ Transcription API failed: ${response.status} - ${errorText}`);
      throw new Error(`Transcription failed: ${response.statusText}`);
    }

    const result = await response.json();
    console.log('📥 Transcription response:', result);

    if (result.success && result.transcript && result.transcript.trim()) {
      console.log(`✅ Transcript received: "${result.transcript}"`);

      // Send transcript to background script which will relay to content script
      // We need to query for the active tab since offscreen doc doesn't have direct access
      chrome.runtime.sendMessage({
        action: 'relayTranscript',
        transcript: {
          text: result.transcript,
          confidence: result.confidence,
          timestamp: Date.now(),
          language: result.language
        }
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.error('❌ Failed to relay transcript:', chrome.runtime.lastError.message);
        } else {
          console.log('✅ Transcript relayed to content script');
        }
      });
    } else {
      console.log('⚠️ No transcript in response or empty transcript');
    }
  } catch (error) {
    console.error('❌ Transcription error:', error);
  }
}

// Play translated audio in offscreen document (not captured by tab capture)
async function playTranslatedAudio(base64Audio, text) {
  // Deduplication: Check if we've already played this exact text
  if (playedAudioTexts.has(text)) {
    console.log('⏭️ [Offscreen] Skipping duplicate audio:', text.substring(0, 50));
    return;
  }

  playedAudioTexts.add(text);

  // Add to queue
  audioPlaybackQueue.push({ base64Audio, text });

  // Start playing if not already playing
  if (!isPlayingTranslatedAudio) {
    playNextInQueue();
  }
}

async function playNextInQueue() {
  if (audioPlaybackQueue.length === 0) {
    isPlayingTranslatedAudio = false;
    console.log('📭 [Offscreen] Audio queue empty');
    return;
  }

  isPlayingTranslatedAudio = true;
  const { base64Audio, text } = audioPlaybackQueue.shift();

  console.log(`🔊 [Offscreen] Playing: "${text.substring(0, 50)}..." (${audioPlaybackQueue.length} in queue)`);

  try {
    // Decode base64 to blob (optimized)
    const binaryString = atob(base64Audio);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const audioBlob = new Blob([bytes], { type: 'audio/mpeg' });

    // Initialize AudioContext if needed
    if (!audioContext) {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();
      console.log('🎵 [Offscreen] AudioContext created');
    }

    // Resume if suspended
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    // Decode audio
    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

    console.log(`   [Offscreen] ${audioBuffer.duration.toFixed(2)}s, ${(audioBlob.size / 1024).toFixed(1)} KB`);

    // Create buffer source
    const source = audioContext.createBufferSource();
    source.buffer = audioBuffer;

    // Create gain node
    const gainNode = audioContext.createGain();
    gainNode.gain.value = 1.0;

    // Connect: source -> gain -> speakers
    source.connect(gainNode);
    gainNode.connect(audioContext.destination);

    // Play next when finished
    source.onended = () => {
      console.log('✅ [Offscreen] Finished');
      playNextInQueue(); // Play next in queue
    };

    // Start playback
    source.start(0);
    console.log('▶️ [Offscreen] Playing');

  } catch (error) {
    console.error('❌ [Offscreen] Playback error:', error);
    playNextInQueue(); // Try next audio on error
  }
}

// Note: Microphone capture is not supported in offscreen documents
// because they cannot request permissions from the user.
// Users should use desktop capture mode instead, which is already supported.