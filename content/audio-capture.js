// Audio capture utilities for live transcription
class AudioCaptureManager {
  constructor(videoElement, onTranscriptChunk, onError) {
    this.videoElement = videoElement;
    this.onTranscriptChunk = onTranscriptChunk;
    this.onError = onError;
    this.mediaRecorder = null;
    this.audioContext = null;
    this.sourceNode = null;
    this.destinationNode = null;
    this.isCapturing = false;
    this.audioChunks = [];
    this.chunkDuration = 3000; // 3 seconds chunks
    this.currentLanguage = 'en';
  }

  /**
   * Start capturing audio from the video element
   */
  async startCapture(sourceLanguage = 'en') {
    try {
      this.currentLanguage = sourceLanguage;

      console.log('🔍 Diagnostics:');
      console.log('  Video paused:', this.videoElement.paused);
      console.log('  Video muted:', this.videoElement.muted);
      console.log('  Video volume:', this.videoElement.volume);
      console.log('  Video currentTime:', this.videoElement.currentTime);
      console.log('  Video duration:', this.videoElement.duration);

      console.log('🎯 Setting up Web Audio API capture...');

      // Create audio context - this works even with muted video
      this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
      console.log('  AudioContext state:', this.audioContext.state);

      // Resume audio context if suspended
      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
        console.log('  AudioContext resumed');
      }

      try {
        // Create media element source from video
        this.sourceNode = this.audioContext.createMediaElementSource(this.videoElement);
        console.log('✅ Created MediaElementSource');
      } catch (error) {
        // If createMediaElementSource fails (already used), try capturing via getUserMedia
        console.warn('⚠️ createMediaElementSource failed (might already be in use):', error.message);
        throw new Error('Unable to capture audio: Audio element already in use by another process');
      }

      // Create destination for capturing
      this.destinationNode = this.audioContext.createMediaStreamDestination();

      // Connect source to destination for capturing
      this.sourceNode.connect(this.destinationNode);

      // CRITICAL: Also connect to speakers so audio actually flows
      this.sourceNode.connect(this.audioContext.destination);

      console.log('✅ Audio routing established');
      console.log('  Destination stream active:', this.destinationNode.stream.active);
      console.log('  Destination stream tracks:', this.destinationNode.stream.getAudioTracks().length);

      if (this.destinationNode.stream.getAudioTracks().length > 0) {
        const track = this.destinationNode.stream.getAudioTracks()[0];
        console.log('  Track enabled:', track.enabled);
        console.log('  Track muted:', track.muted);
        console.log('  Track readyState:', track.readyState);
        console.log('  Track label:', track.label);
      } else {
        throw new Error('No audio tracks available in the media stream');
      }

      // Create media recorder
      const options = {
        mimeType: 'audio/webm;codecs=opus',
        audioBitsPerSecond: 128000
      };

      this.mediaRecorder = new MediaRecorder(this.destinationNode.stream, options);

      this.mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          this.audioChunks.push(event.data);
          console.log(`📦 Data chunk received: ${(event.data.size / 1024).toFixed(2)} KB`);
        }
      };

      this.mediaRecorder.onstop = async () => {
        if (this.audioChunks.length > 0) {
          const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
          console.log(`🎵 Audio chunk captured: ${(audioBlob.size / 1024).toFixed(2)} KB`);
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
          // Restart immediately
          setTimeout(() => {
            if (this.isCapturing && this.mediaRecorder) {
              this.audioChunks = [];
              this.mediaRecorder.start();
            }
          }, 100);
        }
      }, this.chunkDuration);

      console.log('🎤 Audio capture started successfully');
      return true;
    } catch (error) {
      console.error('❌ Failed to start audio capture:', error);
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

    if (this.sourceNode) {
      this.sourceNode.disconnect();
    }

    if (this.audioContext) {
      this.audioContext.close();
    }

    this.mediaRecorder = null;
    this.audioContext = null;
    this.sourceNode = null;
    this.destinationNode = null;
    this.audioChunks = [];

    console.log('🛑 Audio capture stopped');
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
window.AudioCaptureManager = AudioCaptureManager;
