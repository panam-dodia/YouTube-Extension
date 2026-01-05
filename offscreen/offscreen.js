// Offscreen document for tab audio capture
// This runs in a hidden document that can receive MediaStream from background script

console.log('📄 Offscreen document loaded');

let mediaRecorder = null;
let audioChunks = [];
let isCapturing = false;
let chunkDuration = 5000;
let currentLanguage = 'en';
let chunkInterval = null;
let mediaStream = null;

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

    // Create media recorder
    const options = {
      mimeType: 'audio/webm;codecs=opus',
      audioBitsPerSecond: 128000
    };

    mediaRecorder = new MediaRecorder(mediaStream, options);

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
        console.log(`🎵 Audio chunk captured: ${sizeKB.toFixed(2)} KB`);

        // Check if audio chunk is too small (likely silence)
        if (sizeKB < 5) {
          console.log('⚠️ Audio chunk too small, likely silence. Skipping transcription.');
          audioChunks = [];
          return;
        }

        audioChunks = [];

        // Send to transcription via content script
        await transcribeChunk(audioBlob);
      }
    };

    // Start recording in chunks
    mediaRecorder.start();
    isCapturing = true;

    console.log('✅ MediaRecorder started');

    // Stop and restart periodically to create chunks
    chunkInterval = setInterval(() => {
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
        // Restart after a brief pause
        setTimeout(() => {
          if (isCapturing && mediaRecorder) {
            audioChunks = [];
            mediaRecorder.start();
          }
        }, 250);
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

      // Send transcript to content script
      chrome.runtime.sendMessage({
        action: 'transcriptReceived',
        transcript: {
          text: result.transcript,
          confidence: result.confidence,
          timestamp: Date.now(),
          language: result.language
        }
      });
    } else {
      console.log('⚠️ No transcript in response or empty transcript');
    }
  } catch (error) {
    console.error('❌ Transcription error:', error);
  }
}
