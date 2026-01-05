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
    this.analyserNode = null;
    this.isCapturing = false;
    this.audioChunks = [];
    this.chunkDuration = 5000; // 5 seconds chunks for better transcription
    this.currentLanguage = 'en';
    this.silenceThreshold = 0.01; // Minimum audio level to consider as speech
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
      console.log('  Video readyState:', this.videoElement.readyState);
      console.log('  Video networkState:', this.videoElement.networkState);
      console.log('  Video src:', this.videoElement.src?.substring(0, 100) || this.videoElement.currentSrc?.substring(0, 100) || 'No src');

      // Check if video has audio tracks
      if (this.videoElement.mozHasAudio !== undefined) {
        console.log('  Has audio (Firefox):', this.videoElement.mozHasAudio);
      }
      if (this.videoElement.webkitAudioDecodedByteCount !== undefined) {
        console.log('  Audio decoded bytes (Chrome):', this.videoElement.webkitAudioDecodedByteCount);
      }

      // CRITICAL: Wait for video to actually start playing with audio
      // readyState 0 = HAVE_NOTHING, we need at least 2 = HAVE_CURRENT_DATA
      if (this.videoElement.readyState < 2) {
        console.log('⏳ Video not ready yet (readyState:', this.videoElement.readyState, '), waiting for data...');

        try {
          await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              this.videoElement.removeEventListener('canplay', onCanPlay);
              this.videoElement.removeEventListener('playing', onCanPlay);
              this.videoElement.removeEventListener('loadeddata', onCanPlay);
              reject(new Error('Video did not start playing within 15 seconds. Please ensure the video is playing.'));
            }, 15000);

            const onCanPlay = () => {
              console.log('✅ Video ready! readyState:', this.videoElement.readyState);
              clearTimeout(timeout);
              this.videoElement.removeEventListener('canplay', onCanPlay);
              this.videoElement.removeEventListener('playing', onCanPlay);
              this.videoElement.removeEventListener('loadeddata', onCanPlay);
              resolve();
            };

            this.videoElement.addEventListener('canplay', onCanPlay);
            this.videoElement.addEventListener('playing', onCanPlay);
            this.videoElement.addEventListener('loadeddata', onCanPlay);

            // If already ready, resolve immediately
            if (this.videoElement.readyState >= 2) {
              onCanPlay();
            }
          });

          // Extra wait to ensure audio decoder has started
          await new Promise(resolve => setTimeout(resolve, 1000));
          console.log('  Video readyState after wait:', this.videoElement.readyState);
          console.log('  Audio decoded bytes:', this.videoElement.webkitAudioDecodedByteCount);
        } catch (error) {
          console.error('⏰ Timeout waiting for video. Attempting to continue anyway...');
          console.warn('  This may not work if video has no audio or is DRM-protected');
          // Don't throw - try to continue anyway
        }
      } else {
        console.log('✅ Video already ready (readyState:', this.videoElement.readyState, ')');
      }

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

      // Create analyser to monitor audio levels
      this.analyserNode = this.audioContext.createAnalyser();
      this.analyserNode.fftSize = 2048;

      // Create destination for capturing
      this.destinationNode = this.audioContext.createMediaStreamDestination();

      // Connect source to analyser, then to both destination and speakers
      this.sourceNode.connect(this.analyserNode);
      this.analyserNode.connect(this.destinationNode);
      this.analyserNode.connect(this.audioContext.destination);

      console.log('✅ Audio routing established');
      console.log('  Destination stream active:', this.destinationNode.stream.active);
      console.log('  Destination stream tracks:', this.destinationNode.stream.getAudioTracks().length);

      // Check audio level
      this.checkAudioLevel();

      if (this.destinationNode.stream.getAudioTracks().length > 0) {
        const track = this.destinationNode.stream.getAudioTracks()[0];
        console.log('  Track enabled:', track.enabled);
        console.log('  Track muted:', track.muted);
        console.log('  Track readyState:', track.readyState);
        console.log('  Track label:', track.label);
      } else {
        throw new Error('No audio tracks available in the media stream');
      }

      // Create media recorder with better settings
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

  /**
   * Check if audio is actually playing and at what level
   */
  checkAudioLevel() {
    if (!this.analyserNode) return;

    const dataArray = new Uint8Array(this.analyserNode.frequencyBinCount);
    this.analyserNode.getByteTimeDomainData(dataArray);

    // Calculate RMS (Root Mean Square) to get audio level
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const normalized = (dataArray[i] - 128) / 128;
      sum += normalized * normalized;
    }
    const rms = Math.sqrt(sum / dataArray.length);

    console.log(`🔊 Audio level check: ${(rms * 100).toFixed(2)}% (threshold: ${(this.silenceThreshold * 100).toFixed(2)}%)`);

    if (rms < this.silenceThreshold) {
      console.warn('⚠️ WARNING: Audio level is very low or silent!');
      console.warn('   Possible issues:');
      console.warn('   1. Video has no audio track');
      console.warn('   2. Video is muted in the browser');
      console.warn('   3. Video hasn\'t started playing yet');
    } else {
      console.log('✅ Audio is flowing correctly');
    }

    return rms;
  }
}

// Export for use in content script
window.AudioCaptureManager = AudioCaptureManager;
