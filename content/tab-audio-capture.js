// Tab audio capture for DRM-protected content (Netflix, etc.)
// This uses Chrome's Tab Capture API to capture the entire tab's audio,
// which works even with DRM-protected content like Netflix

class TabAudioCaptureManager {
  constructor(onTranscriptChunk, onError) {
    this.onTranscriptChunk = onTranscriptChunk;
    this.onError = onError;
    this.mediaRecorder = null;
    this.audioContext = null;
    this.mediaStream = null;
    this.isCapturing = false;
    this.audioChunks = [];
    this.chunkDuration = 5000; // 5 seconds chunks for better transcription
    this.currentLanguage = 'en';
  }

  /**
   * Start capturing audio from the entire tab
   * @param {string} sourceLanguage - Language code for transcription
   * @param {string} streamId - Tab capture stream ID from popup
   */
  async startCapture(sourceLanguage = 'en', streamId = null) {
    try {
      this.currentLanguage = sourceLanguage;
      console.log('🎬 Starting tab audio capture...');

      if (!streamId) {
        throw new Error('No streamId provided. Tab capture must be started from popup with user gesture.');
      }

      console.log('✅ Using stream ID from popup:', streamId);

      // Get the media stream using the stream ID
      const constraints = {
        audio: {
          mandatory: {
            chromeMediaSource: 'tab',
            chromeMediaSourceId: streamId
          }
        }
      };

      console.log('🎤 Requesting media stream with constraints:', constraints);
      this.mediaStream = await navigator.mediaDevices.getUserMedia(constraints);
      console.log('✅ Got media stream');
      console.log('  Active:', this.mediaStream.active);
      console.log('  Audio tracks:', this.mediaStream.getAudioTracks().length);

      if (this.mediaStream.getAudioTracks().length === 0) {
        throw new Error('No audio tracks in captured stream');
      }

      const audioTrack = this.mediaStream.getAudioTracks()[0];
      console.log('  Track enabled:', audioTrack.enabled);
      console.log('  Track muted:', audioTrack.muted);
      console.log('  Track readyState:', audioTrack.readyState);
      console.log('  Track label:', audioTrack.label);

      // Create audio context for monitoring
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      console.log('  AudioContext state:', this.audioContext.state);

      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
        console.log('  AudioContext resumed');
      }

      // Create media recorder
      const options = {
        mimeType: 'audio/webm;codecs=opus',
        audioBitsPerSecond: 128000
      };

      this.mediaRecorder = new MediaRecorder(this.mediaStream, options);

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
          console.log(`📦 Data chunk received: ${(event.data.size / 1024).toFixed(2)} KB`);
        }
      };

      this.mediaRecorder.onstop = async () => {
        if (this.audioChunks.length > 0) {
          const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm;codecs=opus' });
          const sizeKB = audioBlob.size / 1024;
          console.log(`🎵 Audio chunk captured: ${sizeKB.toFixed(2)} KB`);

          // Check if audio chunk is too small (likely silence)
          if (sizeKB < 5) {
            console.log('⚠️ Audio chunk too small, likely silence. Skipping transcription.');
            this.audioChunks = [];
            return;
          }

          this.audioChunks = [];

          // Send to transcription
          await this.transcribeChunk(audioBlob);
        } else {
          console.log('⚠️ No audio data captured in this chunk');
        }
      };

      this.mediaRecorder.onerror = (event) => {
        console.error('MediaRecorder error:', event.error);
        if (this.onError) {
          this.onError(event.error);
        }
      };

      // Start recording in chunks
      this.mediaRecorder.start();
      this.isCapturing = true;

      console.log('✅ MediaRecorder started, state:', this.mediaRecorder.state);

      // Stop and restart periodically to create chunks
      this.chunkInterval = setInterval(() => {
        if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
          this.mediaRecorder.stop();
          // Restart after a brief pause
          setTimeout(() => {
            if (this.isCapturing && this.mediaRecorder) {
              this.audioChunks = [];
              this.mediaRecorder.start();
            }
          }, 250);
        }
      }, this.chunkDuration);

      console.log('🎤 Tab audio capture started successfully');
      return true;
    } catch (error) {
      console.error('❌ Failed to start tab audio capture:', error);
      console.error('  Error name:', error.name);
      console.error('  Error message:', error.message);

      if (this.onError) {
        this.onError(error);
      }
      return false;
    }
  }

  /**
   * Stop capturing audio
   */
  stopCapture() {
    this.isCapturing = false;

    if (this.chunkInterval) {
      clearInterval(this.chunkInterval);
      this.chunkInterval = null;
    }

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    }

    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach(track => {
        track.stop();
        console.log('🛑 Stopped track:', track.label);
      });
    }

    if (this.audioContext) {
      this.audioContext.close();
    }

    this.mediaRecorder = null;
    this.audioContext = null;
    this.mediaStream = null;
    this.audioChunks = [];

    console.log('🛑 Tab audio capture stopped');
  }

  /**
   * Transcribe an audio chunk
   */
  async transcribeChunk(audioBlob) {
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
          sourceLanguage: this.currentLanguage
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
        // Call the callback with the transcript
        if (this.onTranscriptChunk) {
          this.onTranscriptChunk({
            text: result.transcript,
            confidence: result.confidence,
            timestamp: Date.now(),
            language: result.language
          });
        }
      } else {
        console.log('⚠️ No transcript in response or empty transcript');
      }
    } catch (error) {
      console.error('❌ Transcription error:', error);
      // Don't call onError for individual transcription failures
      // to avoid stopping the entire capture process
    }
  }

  /**
   * Update source language
   */
  setSourceLanguage(language) {
    this.currentLanguage = language;
  }
}

// Export for use in content script
window.TabAudioCaptureManager = TabAudioCaptureManager;
