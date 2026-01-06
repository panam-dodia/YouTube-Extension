// Wrap everything to prevent multiple injections
(function() {
    // Prevent multiple injections
    if (window.audioTranslatorLoaded) {
        console.log('Audio translator already loaded');
        const existing = document.getElementById('audio-analyzer-overlay');
        if (existing) {
            existing.style.display = 'flex';
        }
        return;
    }
    window.audioTranslatorLoaded = true;

// Simple pitch-based gender detection (no TensorFlow.js required)
class GenderDetector {
    detectGender(frequencyData) {
        const pitch = this.getPitch(frequencyData);

        // Male voices: 85-180 Hz (average ~120 Hz)
        // Female voices: 165-255 Hz (average ~210 Hz)

        if (pitch < 140) {
            return {
                gender: 'male',
                confidence: 0.75,
                pitch: pitch.toFixed(0)
            };
        } else if (pitch > 200) {
            return {
                gender: 'female',
                confidence: 0.75,
                pitch: pitch.toFixed(0)
            };
        } else {
            // Overlap range (140-200 Hz) - less confident
            return {
                gender: 'unknown',
                confidence: 0.5,
                pitch: pitch.toFixed(0)
            };
        }
    }

    getPitch(frequencyData) {
        let maxValue = 0;
        let maxIndex = 0;

        // Focus on human voice range (80-300 Hz)
        // Sample rate: 44100 Hz, FFT size: 2048
        // Each bin represents: 44100 / 2048 ≈ 21.5 Hz
        // So 80 Hz ≈ index 4, 300 Hz ≈ index 14

        const startIdx = 4;
        const endIdx = Math.min(20, frequencyData.length);

        for (let i = startIdx; i < endIdx; i++) {
            if (frequencyData[i] > maxValue) {
                maxValue = frequencyData[i];
                maxIndex = i;
            }
        }

        // Convert index to frequency
        const nyquist = 22050; // Half of 44100 Hz
        const binResolution = nyquist / frequencyData.length;
        const pitch = maxIndex * binResolution;

        return pitch;
    }
}

// AudioAnalyzer class with OpenAI translation
class AudioAnalyzer {
    constructor() {
        this.audioContext = null;
        this.analyser = null;
        this.source = null;
        this.gainNode = null;
        this.animationId = null;
        this.mediaElement = null;
        this.mediaRecorder = null;
        this.currentChunk = null;
        this.recordingIntervalId = null;
        this.isRecording = false;
        this.apiKey = localStorage.getItem('openai_api_key') || '';

        this.waveformCanvas = document.getElementById('overlay-waveform');
        this.spectrumCanvas = document.getElementById('overlay-spectrum');
        this.waveformCtx = this.waveformCanvas.getContext('2d');
        this.spectrumCtx = this.spectrumCanvas.getContext('2d');

        this.startBtn = document.getElementById('overlay-start-btn');
        this.stopBtn = document.getElementById('overlay-stop-btn');
        this.statusText = document.getElementById('overlay-status-text');
        this.volumeBar = document.getElementById('overlay-volume-bar');
        this.volumeText = document.getElementById('overlay-volume-text');
        this.peakFreq = document.getElementById('overlay-peak-freq');
        this.avgVolume = document.getElementById('overlay-avg-volume');
        this.sourceText = document.getElementById('overlay-source');
        this.transcriptionBox = document.getElementById('transcription-box');
        this.translationBox = document.getElementById('translation-box');
        this.apiKeyInput = document.getElementById('api-key-input');
        this.saveKeyBtn = document.getElementById('save-key-btn');
        this.languageSelect = document.getElementById('language-select');
        this.modelSelect = document.getElementById('model-select');
        this.ttsEnabledCheckbox = document.getElementById('tts-enabled');
        this.ttsOptionsDiv = document.getElementById('tts-options');
        this.voiceSelect = document.getElementById('voice-select');
        this.ttsQualitySelect = document.getElementById('tts-quality-select');
        this.autoSwitchVoiceCheckbox = document.getElementById('auto-switch-voice');

        // Load saved model preference (default to gpt-4o-mini-transcribe for better accuracy)
        this.selectedModel = localStorage.getItem('transcription_model') || 'gpt-4o-mini-transcribe';

        // Load saved TTS preferences
        this.ttsEnabled = localStorage.getItem('tts_enabled') === 'true';
        this.selectedVoice = localStorage.getItem('tts_voice') || 'nova';
        this.selectedTTSModel = localStorage.getItem('tts_model') || 'gpt-4o-mini-tts';

        // TTS audio queue
        this.audioQueue = [];
        this.isPlayingAudio = false;

        // Gender detection
        this.genderDetector = new GenderDetector();
        this.detectedGender = 'unknown';
        this.genderConfidence = 0;
        this.genderDetectionFrames = 0;
        this.autoSwitchVoice = localStorage.getItem('auto_switch_voice') !== 'false'; // Default true

        // Track chunks for debugging
        this.chunkCounter = 0;

        this.initializeCanvases();
        this.setupEventListeners();

        // Gender detector is ready immediately (no async initialization needed)
        console.log('✅ Simple pitch-based gender detector ready');

        if (this.apiKey) {
            this.apiKeyInput.value = '••••••••';
        }

        // Set saved model in dropdown
        if (this.modelSelect) {
            this.modelSelect.value = this.selectedModel;
        }

        // Set saved TTS preferences in UI
        this.ttsEnabledCheckbox.checked = this.ttsEnabled;
        this.voiceSelect.value = this.selectedVoice;
        this.ttsQualitySelect.value = this.selectedTTSModel;
        this.autoSwitchVoiceCheckbox.checked = this.autoSwitchVoice;

        // Show/hide TTS options based on saved preference
        if (this.ttsEnabled) {
            this.ttsOptionsDiv.style.display = 'block';
        }
    }

    initializeCanvases() {
        this.waveformCanvas.width = this.waveformCanvas.offsetWidth * 2;
        this.waveformCanvas.height = 160;
        this.spectrumCanvas.width = this.spectrumCanvas.offsetWidth * 2;
        this.spectrumCanvas.height = 160;
    }

    setupEventListeners() {
        this.startBtn.addEventListener('click', () => this.start());
        this.stopBtn.addEventListener('click', () => this.stop());
        this.saveKeyBtn.addEventListener('click', () => this.saveApiKey());
        document.getElementById('clear-transcript-btn').addEventListener('click', () => {
            this.transcriptionBox.innerHTML = '<div class="transcript-placeholder">Original transcription will appear here...</div>';
            this.translationBox.innerHTML = '<div class="transcript-placeholder">Translation will appear here...</div>';
        });

        // Save model selection when changed
        this.modelSelect.addEventListener('change', () => {
            this.selectedModel = this.modelSelect.value;
            localStorage.setItem('transcription_model', this.selectedModel);
            console.log('Transcription model changed to:', this.selectedModel);
        });

        // TTS toggle
        this.ttsEnabledCheckbox.addEventListener('change', () => {
            this.ttsEnabled = this.ttsEnabledCheckbox.checked;
            localStorage.setItem('tts_enabled', this.ttsEnabled);

            // Show/hide TTS options
            if (this.ttsEnabled) {
                this.ttsOptionsDiv.style.display = 'block';
                console.log('🔊 Voice translation enabled');
                // Silence original audio if currently capturing
                if (this.gainNode && this.isRecording) {
                    this.gainNode.gain.value = 0;
                    console.log('🔇 Original video audio silenced');
                }
            } else {
                this.ttsOptionsDiv.style.display = 'none';
                console.log('🔇 Voice translation disabled');
                // Restore original audio if currently capturing
                if (this.gainNode && this.isRecording) {
                    this.gainNode.gain.value = 1.0;
                    console.log('🔊 Original video audio restored');
                }
            }
        });

        // Voice selection
        this.voiceSelect.addEventListener('change', () => {
            this.selectedVoice = this.voiceSelect.value;
            localStorage.setItem('tts_voice', this.selectedVoice);
            console.log('Voice changed to:', this.selectedVoice);
        });

        // TTS quality selection
        this.ttsQualitySelect.addEventListener('change', () => {
            this.selectedTTSModel = this.ttsQualitySelect.value;
            localStorage.setItem('tts_model', this.selectedTTSModel);
            console.log('TTS model changed to:', this.selectedTTSModel);
        });

        // Auto-switch voice toggle
        this.autoSwitchVoiceCheckbox.addEventListener('change', () => {
            this.autoSwitchVoice = this.autoSwitchVoiceCheckbox.checked;
            localStorage.setItem('auto_switch_voice', this.autoSwitchVoice);
            if (this.autoSwitchVoice) {
                console.log('🎭 Auto-switch voice enabled (will detect gender and switch TTS voice)');
            } else {
                console.log('🎭 Auto-switch voice disabled (will use selected voice)');
            }
        });
    }

    saveApiKey() {
        const key = this.apiKeyInput.value.trim();
        if (key && key !== '••••••••') {
            this.apiKey = key;
            localStorage.setItem('openai_api_key', key);
            this.apiKeyInput.value = '••••••••';
            alert('API key saved!');
        }
    }

    findMediaElements() {
        const allMedia = [
            ...document.querySelectorAll('audio'),
            ...document.querySelectorAll('video')
        ];
        console.log('Found media elements:', allMedia.length);
        return allMedia;
    }

    async start() {
        try {
            if (!this.apiKey) {
                this.updateStatus('Please enter OpenAI API key first!', 'error');
                return;
            }

            // Reset chunk counter for new session
            this.chunkCounter = 0;

            this.updateStatus('Searching for audio...', 'warning');

            const mediaElements = this.findMediaElements();

            if (mediaElements.length === 0) {
                this.updateStatus('No audio/video found on page!', 'error');
                setTimeout(() => this.updateStatus('Ready to capture', 'info'), 3000);
                return;
            }

            this.mediaElement = mediaElements[0];

            // Create audio context
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 2048;
            this.analyser.smoothingTimeConstant = 0.8;

            // Create gain node to control original video volume
            this.gainNode = this.audioContext.createGain();
            this.gainNode.gain.value = 1.0; // Default: full volume

            // Create destination for recording
            let dest = this.audioContext.createMediaStreamDestination();

            if (!this.mediaElement._audioSource) {
                this.source = this.audioContext.createMediaElementSource(this.mediaElement);
                this.mediaElement._audioSource = this.source;
                this.mediaElement._audioDest = dest;
                this.mediaElement._gainNode = this.gainNode;

                // Audio routing:
                // source → analyser (for waveforms)
                // source → dest (for recording/transcription)
                // source → gainNode → destination (for speakers, volume controlled)
                this.source.connect(this.analyser);
                this.source.connect(dest);
                this.source.connect(this.gainNode);
                this.gainNode.connect(this.audioContext.destination);
            } else {
                // Reuse existing source
                this.source = this.mediaElement._audioSource;
                dest = this.mediaElement._audioDest || dest;
                this.gainNode = this.mediaElement._gainNode || this.gainNode;

                // Reconnect if needed
                try {
                    this.source.connect(this.analyser);
                    this.source.connect(dest);
                    this.source.connect(this.gainNode);
                    this.gainNode.connect(this.audioContext.destination);
                } catch (e) {
                    // Already connected
                }
            }

            // Resume audio context if suspended
            if (this.audioContext.state === 'suspended') {
                await this.audioContext.resume();
            }

            // Start recording for transcription
            this.mediaRecorder = new MediaRecorder(dest.stream);
            this.recordingIntervalId = null;

            // Collect audio data
            this.mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    this.currentChunk = event.data;
                }
            };

            this.mediaRecorder.onstop = async () => {
                if (this.currentChunk && this.currentChunk.size > 0) {
                    this.chunkCounter++;
                    const chunkId = this.chunkCounter;
                    const audioBlob = this.currentChunk;

                    console.log(`📦 Chunk #${chunkId} received: ${audioBlob.size} bytes`);

                    // Skip very small chunks (likely silence)
                    if (audioBlob.size >= 500) {
                        // Process asynchronously
                        this.transcribeAndTranslate(audioBlob, chunkId).catch(err => {
                            console.error(`❌ Chunk #${chunkId} processing error:`, err);
                        });
                    } else {
                        console.log(`⏭️  Skipping tiny chunk #${chunkId}: ${audioBlob.size} bytes`);
                    }

                    this.currentChunk = null;
                }

                // Immediately start next chunk if still recording
                if (this.isRecording) {
                    this.mediaRecorder.start();
                }
            };

            // Start first recording
            this.isRecording = true;
            this.mediaRecorder.start();

            // Set up interval to stop and restart (creates complete audio files)
            const CHUNK_DURATION = 3000;
            this.recordingIntervalId = setInterval(() => {
                if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
                    this.mediaRecorder.stop(); // This triggers onstop which restarts
                }
            }, CHUNK_DURATION);

            this.startBtn.disabled = true;
            this.stopBtn.disabled = false;
            this.updateStatus('● Capturing & translating...', 'success');

            const sourceType = this.mediaElement.tagName.toLowerCase();
            this.sourceText.textContent = sourceType === 'video' ? 'Video' : 'Audio';

            // Silence original video audio if TTS is enabled (using gain node, not mute)
            if (this.ttsEnabled) {
                this.gainNode.gain.value = 0; // Silent
                console.log('🔇 Original video audio silenced (TTS mode, waveforms still work)');
            } else {
                this.gainNode.gain.value = 1.0; // Full volume
            }

            this.visualize();

        } catch (error) {
            console.error('Full error:', error);
            if (error.name === 'InvalidStateError') {
                this.updateStatus('Already connected! Refresh page to restart.', 'error');
            } else if (error.name === 'NotSupportedError') {
                this.updateStatus('Audio source already in use.', 'error');
            } else {
                this.updateStatus(`Error: ${error.message}`, 'error');
            }
            this.resetUI();
        }
    }


    async transcribeAndTranslate(audioBlob, chunkId) {
        const startTime = Date.now();

        try {
            console.log(`🔄 Processing chunk #${chunkId} (${(audioBlob.size / 1024).toFixed(1)}KB) with ${this.selectedModel}...`);

            // Step 1: Transcribe with selected model (auto-detect language)
            const formData = new FormData();
            formData.append('file', audioBlob, 'audio.webm');
            formData.append('model', this.selectedModel);
            // No language or response_format parameter = auto-detect language, JSON response

            const transcriptResponse = await fetch('https://api.openai.com/v1/audio/transcriptions', {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: formData
            });

            if (!transcriptResponse.ok) {
                // Get detailed error message from API
                let errorMessage = `HTTP ${transcriptResponse.status} ${transcriptResponse.statusText}`;
                try {
                    const errorData = await transcriptResponse.json();
                    errorMessage += `: ${errorData.error?.message || JSON.stringify(errorData)}`;
                } catch {
                    const errorText = await transcriptResponse.text();
                    if (errorText) errorMessage += `: ${errorText}`;
                }
                throw new Error(errorMessage);
            }

            const transcriptData = await transcriptResponse.json();
            const originalText = transcriptData.text;

            if (originalText && originalText.trim()) {
                console.log(`📝 Chunk #${chunkId} transcribed: "${originalText}"`);
                this.addTranscriptLine(originalText, false);

                // Step 2: Translate with GPT-4o-mini
                const targetLanguage = this.languageSelect.value;

                const translateResponse = await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${this.apiKey}`
                    },
                    body: JSON.stringify({
                        model: 'gpt-4o-mini',
                        messages: [{
                            role: 'system',
                            content: `You are a translator. Translate the user's text to ${targetLanguage}. Return ONLY the translated text, nothing else. No explanations, no extra words.`
                        }, {
                            role: 'user',
                            content: originalText
                        }],
                        response_format: {
                            type: 'json_schema',
                            json_schema: {
                                name: 'translation',
                                strict: true,
                                schema: {
                                    type: 'object',
                                    properties: {
                                        translated_text: {
                                            type: 'string',
                                            description: 'The translated text'
                                        }
                                    },
                                    required: ['translated_text'],
                                    additionalProperties: false
                                }
                            }
                        },
                        temperature: 0.1,
                        max_tokens: 500
                    })
                });

                if (!translateResponse.ok) {
                    throw new Error('Translation API error: ' + translateResponse.statusText);
                }

                const translateData = await translateResponse.json();
                const parsed = JSON.parse(translateData.choices[0].message.content);
                const translatedText = parsed.translated_text;

                this.addTranslationLine(translatedText, false);

                // Step 3: Generate and play TTS if enabled
                if (this.ttsEnabled && translatedText) {
                    try {
                        const ttsAudio = await this.generateTTS(translatedText, chunkId);
                        this.enqueueTTS(ttsAudio, chunkId);
                    } catch (ttsError) {
                        console.error(`TTS failed for chunk #${chunkId}, continuing without voice:`, ttsError);
                        // Don't fail the whole process if TTS fails
                    }
                }

                // Log total processing time
                const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
                const ttsStatus = this.ttsEnabled ? ' + TTS' : '';
                console.log(`✅ Chunk #${chunkId} processed in ${totalTime}s (${this.selectedModel} + Translation${ttsStatus})`);
            } else {
                console.log(`🔇 Chunk #${chunkId} returned empty transcription (likely silence or background noise)`);
            }

        } catch (error) {
            console.error(`❌ Chunk #${chunkId} error:`, error);
            this.addTranscriptLine(`Error (chunk #${chunkId}): ` + error.message, true);
        }
    }

    addTranscriptLine(text, isError = false) {
        const placeholder = this.transcriptionBox.querySelector('.transcript-placeholder');
        if (placeholder) placeholder.remove();

        const line = document.createElement('div');
        line.className = 'transcript-line';
        if (isError) line.style.color = '#ff006e';

        const time = new Date().toLocaleTimeString();
        line.innerHTML = `<span class="transcript-time">${time}</span>${text}`;

        this.transcriptionBox.appendChild(line);
        this.transcriptionBox.scrollTop = this.transcriptionBox.scrollHeight;
    }

    addTranslationLine(text, isError = false) {
        const placeholder = this.translationBox.querySelector('.transcript-placeholder');
        if (placeholder) placeholder.remove();

        const line = document.createElement('div');
        line.className = 'transcript-line';
        if (isError) line.style.color = '#ff006e';

        const time = new Date().toLocaleTimeString();
        line.innerHTML = `<span class="transcript-time">${time}</span>${text}`;

        this.translationBox.appendChild(line);
        this.translationBox.scrollTop = this.translationBox.scrollHeight;
    }

    async generateTTS(text, chunkId) {
        try {
            // Auto-select voice based on detected gender
            let voiceToUse = this.selectedVoice;

            if (this.autoSwitchVoice && this.detectedGender !== 'unknown') {
                if (this.detectedGender === 'male') {
                    voiceToUse = 'echo'; // Male voice
                } else if (this.detectedGender === 'female') {
                    voiceToUse = 'nova'; // Female voice
                }
                console.log(`🎭 Auto-selected ${voiceToUse} voice for ${this.detectedGender} speaker`);
            }

            console.log(`🎤 Generating TTS for chunk #${chunkId} with model "${this.selectedTTSModel}" voice "${voiceToUse}"...`);

            const response = await fetch('https://api.openai.com/v1/audio/speech', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.apiKey}`
                },
                body: JSON.stringify({
                    model: this.selectedTTSModel,
                    input: text,
                    voice: voiceToUse,
                    response_format: 'mp3',
                    speed: 1.0
                })
            });

            if (!response.ok) {
                let errorMessage = `HTTP ${response.status} ${response.statusText}`;
                try {
                    const errorData = await response.json();
                    errorMessage += `: ${errorData.error?.message || JSON.stringify(errorData)}`;
                } catch {
                    const errorText = await response.text();
                    if (errorText) errorMessage += `: ${errorText}`;
                }
                throw new Error(errorMessage);
            }

            const audioBlob = await response.blob();
            console.log(`✅ TTS generated for chunk #${chunkId}: ${(audioBlob.size / 1024).toFixed(1)}KB`);

            return audioBlob;

        } catch (error) {
            console.error(`❌ TTS generation error for chunk #${chunkId}:`, error);
            throw error;
        }
    }

    async playTTSAudio(audioBlob, chunkId) {
        return new Promise((resolve, reject) => {
            const audioUrl = URL.createObjectURL(audioBlob);
            const audio = new Audio(audioUrl);

            audio.onended = () => {
                URL.revokeObjectURL(audioUrl);
                console.log(`🔊 Finished playing TTS for chunk #${chunkId}`);
                resolve();
            };

            audio.onerror = (error) => {
                URL.revokeObjectURL(audioUrl);
                console.error(`❌ TTS playback error for chunk #${chunkId}:`, error);
                reject(error);
            };

            console.log(`🔊 Playing TTS for chunk #${chunkId}...`);
            audio.play().catch(reject);
        });
    }

    async processAudioQueue() {
        if (this.isPlayingAudio || this.audioQueue.length === 0) {
            return;
        }

        this.isPlayingAudio = true;

        while (this.audioQueue.length > 0) {
            const { audioBlob, chunkId } = this.audioQueue.shift();

            try {
                await this.playTTSAudio(audioBlob, chunkId);
            } catch (error) {
                console.error(`Error playing audio for chunk #${chunkId}:`, error);
            }

            // Small gap between chunks
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        this.isPlayingAudio = false;
    }

    enqueueTTS(audioBlob, chunkId) {
        this.audioQueue.push({ audioBlob, chunkId });
        console.log(`📥 TTS queued for chunk #${chunkId} (queue length: ${this.audioQueue.length})`);
        this.processAudioQueue();
    }

    stop() {
        this.isRecording = false;

        // Clear the recording interval
        if (this.recordingIntervalId) {
            clearInterval(this.recordingIntervalId);
            this.recordingIntervalId = null;
        }

        if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
            this.mediaRecorder.stop();
        }

        // Restore original video audio volume
        if (this.gainNode) {
            this.gainNode.gain.value = 1.0;
            console.log('🔊 Original video audio restored');
        }

        // Clear TTS audio queue
        this.audioQueue = [];
        this.isPlayingAudio = false;

        // DON'T disconnect from destination - keep audio playing!
        // Only disconnect analyser
        if (this.source && this.analyser) {
            try {
                this.source.disconnect(this.analyser);
            } catch(e) {
                console.log('Already disconnected from analyser');
            }
        }

        // DON'T close audio context - keep it alive for audio playback
        // DON'T disconnect gain node - keep video audio working
        // if (this.audioContext && this.audioContext.state !== 'closed') {
        //     this.audioContext.close();
        //     this.audioContext = null;
        // }

        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }

        this.analyser = null;
        this.mediaElement = null;
        // Don't null out this.source or this.gainNode - keep audio working!

        this.resetUI();
        this.updateStatus('Stopped', 'info');
        this.clearCanvases();
    }

    visualize() {
        const bufferLength = this.analyser.frequencyBinCount;
        const timeData = new Uint8Array(bufferLength);
        const freqData = new Uint8Array(bufferLength);

        const draw = () => {
            this.animationId = requestAnimationFrame(draw);
            this.analyser.getByteTimeDomainData(timeData);
            this.analyser.getByteFrequencyData(freqData);

            this.drawWaveform(timeData);
            this.drawSpectrum(freqData);
            this.updateVolume(timeData);
            this.updateAnalysis(freqData, timeData);
        };

        draw();
    }

    drawWaveform(dataArray) {
        const canvas = this.waveformCanvas;
        const ctx = this.waveformCtx;
        const width = canvas.width;
        const height = canvas.height;

        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, width, height);
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#00ff88';
        ctx.beginPath();

        const sliceWidth = width / dataArray.length;
        let x = 0;

        for (let i = 0; i < dataArray.length; i++) {
            const v = dataArray[i] / 128.0;
            const y = (v * height) / 2;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
            x += sliceWidth;
        }

        ctx.lineTo(width, height / 2);
        ctx.stroke();
    }

    drawSpectrum(dataArray) {
        const canvas = this.spectrumCanvas;
        const ctx = this.spectrumCtx;
        const width = canvas.width;
        const height = canvas.height;

        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, width, height);

        const barWidth = (width / dataArray.length) * 2.5;
        let x = 0;

        for (let i = 0; i < dataArray.length; i++) {
            const barHeight = (dataArray[i] / 255) * height;
            const gradient = ctx.createLinearGradient(0, height - barHeight, 0, height);
            gradient.addColorStop(0, '#ff006e');
            gradient.addColorStop(0.5, '#8338ec');
            gradient.addColorStop(1, '#3a86ff');
            ctx.fillStyle = gradient;
            ctx.fillRect(x, height - barHeight, barWidth, barHeight);
            x += barWidth + 1;
        }
    }

    updateVolume(dataArray) {
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
            const normalized = (dataArray[i] - 128) / 128;
            sum += normalized * normalized;
        }
        const rms = Math.sqrt(sum / dataArray.length);
        const db = 20 * Math.log10(rms);

        const normalizedVolume = Math.max(0, Math.min(100, (db + 60) * (100 / 60)));
        this.volumeBar.style.width = normalizedVolume + '%';

        if (normalizedVolume > 80) this.volumeBar.style.backgroundColor = '#ff006e';
        else if (normalizedVolume > 50) this.volumeBar.style.backgroundColor = '#ffbe0b';
        else this.volumeBar.style.backgroundColor = '#00ff88';

        this.volumeText.textContent = db > -60 ? db.toFixed(1) + ' dB' : '-∞ dB';
    }

    updateAnalysis(freqData, timeData) {
        let maxValue = 0, maxIndex = 0;
        for (let i = 0; i < freqData.length; i++) {
            if (freqData[i] > maxValue) {
                maxValue = freqData[i];
                maxIndex = i;
            }
        }

        const nyquist = this.audioContext.sampleRate / 2;
        const peakFrequency = (maxIndex * nyquist) / freqData.length;
        this.peakFreq.textContent = peakFrequency.toFixed(0) + ' Hz';

        let sum = 0;
        for (let i = 0; i < timeData.length; i++) {
            const normalized = (timeData[i] - 128) / 128;
            sum += normalized * normalized;
        }
        const rms = Math.sqrt(sum / timeData.length);
        const db = 20 * Math.log10(rms);
        this.avgVolume.textContent = db > -60 ? db.toFixed(1) + ' dB' : '-∞ dB';

        // Gender detection (run every 30 frames to reduce overhead)
        if (this.autoSwitchVoice && this.ttsEnabled) {
            this.genderDetectionFrames++;
            if (this.genderDetectionFrames >= 30 && maxValue > 50) { // Only detect when there's audio
                this.genderDetectionFrames = 0;
                const result = this.genderDetector.detectGender(freqData);
                if (result && result.confidence > 0.6) {
                    this.detectedGender = result.gender;
                    this.genderConfidence = result.confidence;
                    this.updateGenderDisplay();
                }
            }
        }
    }

    updateStatus(message, type) {
        this.statusText.textContent = message;
        this.statusText.className = 'status-' + type;
    }

    updateGenderDisplay() {
        const genderIndicator = document.getElementById('gender-indicator');
        if (genderIndicator && this.detectedGender !== 'unknown') {
            const icon = this.detectedGender === 'male' ? '👨' : '👩';
            const confidencePercent = (this.genderConfidence * 100).toFixed(0);
            genderIndicator.textContent = `${icon} ${this.detectedGender} (${confidencePercent}%)`;
            genderIndicator.style.display = 'block';
        }
    }

    resetUI() {
        this.startBtn.disabled = false;
        this.stopBtn.disabled = true;
    }

    clearCanvases() {
        this.waveformCtx.fillStyle = '#1a1a2e';
        this.waveformCtx.fillRect(0, 0, this.waveformCanvas.width, this.waveformCanvas.height);
        this.spectrumCtx.fillStyle = '#1a1a2e';
        this.spectrumCtx.fillRect(0, 0, this.spectrumCanvas.width, this.spectrumCanvas.height);

        this.volumeBar.style.width = '0%';
        this.volumeText.textContent = '0 dB';
        this.peakFreq.textContent = '0 Hz';
        this.avgVolume.textContent = '0 dB';
        this.sourceText.textContent = 'None';
    }
}

// createOverlay function
function createOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'audio-analyzer-overlay';
    overlay.innerHTML = `
        <div class="overlay-header">
            <div class="overlay-title">
                <span>🌐</span> Live Translator
            </div>
            <div class="overlay-controls">
                <button class="control-btn minimize-btn" title="Minimize">−</button>
                <button class="control-btn close-btn" title="Close">×</button>
            </div>
        </div>
        <div class="overlay-content">
            <div class="api-config">
                <input type="password" id="api-key-input" placeholder="OpenAI API Key" class="api-input" />
                <button id="save-key-btn" class="small-btn">Save</button>
            </div>

            <div class="language-selector">
                <label>Translate to:</label>
                <select id="language-select" class="lang-select">
                    <option value="English">English</option>
                    <option value="Gujarati">Gujarati</option>
                    <option value="Hindi">Hindi</option>
                    <option value="Spanish">Spanish</option>
                    <option value="French">French</option>
                    <option value="German">German</option>
                    <option value="Japanese">Japanese</option>
                    <option value="Korean">Korean</option>
                    <option value="Chinese">Chinese</option>
                    <option value="Arabic">Arabic</option>
                    <option value="Portuguese">Portuguese</option>
                </select>
            </div>

            <div class="language-selector">
                <label>Transcription:</label>
                <select id="model-select" class="lang-select">
                    <option value="gpt-4o-mini-transcribe">GPT-4o Mini (Better)</option>
                    <option value="whisper-1">Whisper-1 (Cheaper)</option>
                </select>
            </div>

            <div class="tts-config">
                <div class="tts-toggle">
                    <label class="toggle-label">
                        <input type="checkbox" id="tts-enabled" />
                        <span class="toggle-text">🔊 Voice Translation</span>
                    </label>
                </div>
                <div id="tts-options" class="tts-options" style="display: none;">
                    <div class="tts-toggle" style="margin-bottom: 8px;">
                        <label class="toggle-label">
                            <input type="checkbox" id="auto-switch-voice" checked />
                            <span class="toggle-text" style="font-size: 11px;">🎭 Auto-switch voice by gender</span>
                        </label>
                    </div>
                    <div id="gender-indicator" class="gender-indicator" style="display: none;">
                        Detecting...
                    </div>
                    <div class="language-selector">
                        <label>Voice:</label>
                        <select id="voice-select" class="lang-select">
                            <option value="alloy">Alloy (Neutral)</option>
                            <option value="echo">Echo (Male)</option>
                            <option value="fable">Fable (British)</option>
                            <option value="onyx">Onyx (Deep)</option>
                            <option value="nova">Nova (Female)</option>
                            <option value="shimmer">Shimmer (Warm)</option>
                        </select>
                    </div>
                    <div class="language-selector">
                        <label>TTS Model:</label>
                        <select id="tts-quality-select" class="lang-select">
                            <option value="gpt-4o-mini-tts">GPT-4o Mini TTS (Fastest, $0.60/1M)</option>
                            <option value="tts-1">TTS-1 Standard ($15/1M)</option>
                            <option value="tts-1-hd">TTS-1 HD ($30/1M)</option>
                        </select>
                    </div>
                </div>
            </div>

            <div class="overlay-buttons">
                <button id="overlay-start-btn" class="overlay-btn btn-start">Start Translation</button>
                <button id="overlay-stop-btn" class="overlay-btn btn-stop" disabled>Stop</button>
            </div>
            <div class="overlay-status">
                <span id="overlay-status-text">Ready to translate</span>
            </div>

            <div class="transcription-section">
                <div class="transcription-header">
                    <span>🎤 Original (Auto-detected)</span>
                    <button id="clear-transcript-btn" class="small-btn">Clear</button>
                </div>
                <div id="transcription-box" class="transcription-box">
                    <div class="transcript-placeholder">Original transcription will appear here...</div>
                </div>
            </div>

            <div class="transcription-section">
                <div class="transcription-header">
                    <span>🌐 Translation</span>
                </div>
                <div id="translation-box" class="transcription-box">
                    <div class="transcript-placeholder">Translation will appear here...</div>
                </div>
            </div>

            <div class="overlay-visualizations">
                <div class="viz-panel">
                    <div class="viz-header">Waveform</div>
                    <canvas id="overlay-waveform"></canvas>
                </div>
                <div class="viz-panel">
                    <div class="viz-header">Spectrum</div>
                    <canvas id="overlay-spectrum"></canvas>
                </div>
                <div class="viz-panel">
                    <div class="viz-header">Volume</div>
                    <div class="volume-display">
                        <div id="overlay-volume-bar" class="volume-bar"></div>
                    </div>
                    <div id="overlay-volume-text" class="volume-text">0 dB</div>
                </div>
            </div>

            <div class="overlay-data">
                <div class="data-row">
                    <span class="data-label">Peak Freq:</span>
                    <span id="overlay-peak-freq" class="data-value">0 Hz</span>
                </div>
                <div class="data-row">
                    <span class="data-label">Avg Volume:</span>
                    <span id="overlay-avg-volume" class="data-value">0 dB</span>
                </div>
                <div class="data-row">
                    <span class="data-label">Source:</span>
                    <span id="overlay-source" class="data-value">None</span>
                </div>
            </div>
        </div>
    `;

    const style = document.createElement('style');
    style.textContent = `
        #audio-analyzer-overlay {
            position: fixed;
            top: 20px;
            right: 20px;
            width: 450px;
            max-height: 90vh;
            background: linear-gradient(135deg, rgba(15, 12, 41, 0.98) 0%, rgba(48, 43, 99, 0.98) 100%);
            border-radius: 15px;
            box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
            z-index: 2147483647;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            color: white;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.2);
            overflow: hidden;
            display: flex;
            flex-direction: column;
        }

        #audio-analyzer-overlay * {
            box-sizing: border-box;
        }

        #audio-analyzer-overlay.minimized .overlay-content {
            display: none;
        }

        #audio-analyzer-overlay.minimized {
            cursor: pointer;
        }

        #audio-analyzer-overlay.minimized .overlay-header {
            cursor: pointer;
        }

        .overlay-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            padding: 12px 15px;
            background: rgba(0, 255, 136, 0.1);
            border-bottom: 1px solid rgba(255, 255, 255, 0.1);
            cursor: move;
            user-select: none;
            flex-shrink: 0;
        }

        .overlay-title {
            display: flex;
            align-items: center;
            gap: 8px;
            font-weight: 600;
            font-size: 14px;
        }

        .overlay-controls {
            display: flex;
            gap: 5px;
        }

        .control-btn, .small-btn {
            width: 24px;
            height: 24px;
            border: none;
            background: rgba(255, 255, 255, 0.1);
            color: white;
            border-radius: 4px;
            cursor: pointer;
            font-size: 16px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background 0.2s;
        }

        .small-btn {
            width: auto;
            padding: 4px 12px;
            font-size: 11px;
            font-weight: 600;
        }

        .control-btn:hover, .small-btn:hover {
            background: rgba(255, 255, 255, 0.2);
        }

        .close-btn:hover {
            background: rgba(255, 0, 110, 0.5);
        }

        .overlay-content {
            padding: 15px;
            overflow-y: auto;
            flex: 1;
        }

        .api-config {
            display: flex;
            gap: 8px;
            margin-bottom: 12px;
        }

        .api-input {
            flex: 1;
            padding: 8px 12px;
            background: rgba(255, 255, 255, 0.05);
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 6px;
            color: white;
            font-size: 12px;
        }

        .api-input::placeholder {
            color: #666;
        }

        .language-selector {
            display: flex;
            align-items: center;
            gap: 10px;
            margin-bottom: 12px;
            padding: 10px;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 6px;
        }

        .language-selector label {
            font-size: 12px;
            font-weight: 600;
            color: #00ff88;
        }

        .lang-select {
            flex: 1;
            padding: 6px 10px;
            background: rgba(255, 255, 255, 0.1);
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 4px;
            color: white;
            font-size: 12px;
            cursor: pointer;
        }

        .lang-select option {
            background: #1a1a2e;
            color: white;
        }

        .tts-config {
            margin-bottom: 12px;
            padding: 10px;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 6px;
            border: 1px solid rgba(255, 255, 255, 0.1);
        }

        .tts-toggle {
            margin-bottom: 8px;
        }

        .toggle-label {
            display: flex;
            align-items: center;
            gap: 8px;
            cursor: pointer;
            user-select: none;
        }

        .toggle-label input[type="checkbox"] {
            width: 18px;
            height: 18px;
            cursor: pointer;
        }

        .toggle-text {
            font-size: 13px;
            font-weight: 600;
            color: #00d4ff;
        }

        .tts-options {
            margin-top: 8px;
            padding-top: 8px;
            border-top: 1px solid rgba(255, 255, 255, 0.1);
        }

        .tts-options .language-selector {
            margin-bottom: 8px;
        }

        .tts-options .language-selector:last-child {
            margin-bottom: 0;
        }

        .gender-indicator {
            padding: 6px 10px;
            background: rgba(0, 212, 255, 0.1);
            border-radius: 4px;
            border-left: 2px solid #00d4ff;
            font-size: 11px;
            color: #00d4ff;
            margin-bottom: 8px;
            text-align: center;
            font-weight: 600;
        }

        .overlay-buttons {
            display: flex;
            gap: 10px;
            margin-bottom: 12px;
        }

        .overlay-btn {
            flex: 1;
            padding: 10px;
            border: none;
            border-radius: 6px;
            font-weight: 600;
            font-size: 12px;
            cursor: pointer;
            transition: all 0.2s;
            text-transform: uppercase;
        }

        .overlay-btn:disabled {
            opacity: 0.5;
            cursor: not-allowed;
        }

        .btn-start {
            background: linear-gradient(135deg, #00ff88 0%, #00d4ff 100%);
            color: #0f0c29;
        }

        .btn-start:hover:not(:disabled) {
            transform: translateY(-1px);
            box-shadow: 0 5px 15px rgba(0, 255, 136, 0.3);
        }

        .btn-stop {
            background: linear-gradient(135deg, #ff006e 0%, #ff4d6d 100%);
            color: white;
        }

        .btn-stop:hover:not(:disabled) {
            transform: translateY(-1px);
            box-shadow: 0 5px 15px rgba(255, 0, 110, 0.3);
        }

        .overlay-status {
            text-align: center;
            padding: 8px;
            font-size: 12px;
            margin-bottom: 12px;
            border-radius: 6px;
            background: rgba(255, 255, 255, 0.05);
        }

        .transcription-section {
            margin-bottom: 12px;
            background: rgba(255, 255, 255, 0.05);
            border-radius: 8px;
            padding: 10px;
            border: 1px solid rgba(255, 255, 255, 0.1);
        }

        .transcription-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 8px;
            font-size: 11px;
            color: #00ff88;
            font-weight: 600;
            text-transform: uppercase;
        }

        .transcription-box {
            background: #1a1a2e;
            border-radius: 6px;
            padding: 12px;
            min-height: 100px;
            max-height: 150px;
            overflow-y: auto;
            font-size: 13px;
            line-height: 1.6;
        }

        .transcript-placeholder {
            color: #666;
            font-style: italic;
        }

        .transcript-line {
            margin-bottom: 8px;
            padding: 6px 8px;
            background: rgba(0, 255, 136, 0.05);
            border-radius: 4px;
            border-left: 2px solid #00ff88;
        }

        .transcript-time {
            font-size: 10px;
            color: #00d4ff;
            margin-right: 8px;
        }

        .overlay-visualizations {
            display: flex;
            flex-direction: column;
            gap: 12px;
            margin-bottom: 12px;
        }

        .viz-panel {
            background: rgba(255, 255, 255, 0.05);
            border-radius: 8px;
            padding: 10px;
            border: 1px solid rgba(255, 255, 255, 0.1);
        }

        .viz-header {
            font-size: 11px;
            color: #00ff88;
            margin-bottom: 8px;
            font-weight: 600;
            text-transform: uppercase;
        }

        canvas {
            width: 100%;
            height: 80px;
            border-radius: 6px;
            background: #1a1a2e;
            display: block;
        }

        .volume-display {
            width: 100%;
            height: 30px;
            background: #1a1a2e;
            border-radius: 6px;
            overflow: hidden;
            margin-bottom: 8px;
        }

        .volume-bar {
            height: 100%;
            width: 0%;
            background: #00ff88;
            transition: width 0.1s ease, background-color 0.3s ease;
            box-shadow: 0 0 10px currentColor;
        }

        .volume-text {
            text-align: center;
            font-weight: 600;
            font-size: 13px;
            color: #00ff88;
        }

        .overlay-data {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 10px;
        }

        .overlay-data .data-row:last-child {
            grid-column: 1 / -1;
        }

        .data-row {
            background: rgba(255, 255, 255, 0.05);
            padding: 10px;
            border-radius: 6px;
            border-left: 2px solid #00ff88;
        }

        .data-label {
            display: block;
            font-size: 10px;
            color: #a0a0b0;
            margin-bottom: 4px;
            text-transform: uppercase;
        }

        .data-value {
            display: block;
            font-size: 14px;
            font-weight: 700;
            color: #00ff88;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }

        .status-success { color: #00ff88; }
        .status-error { color: #ff006e; }
        .status-warning { color: #ffbe0b; }
        .status-info { color: #00d4ff; }
    `;

    document.head.appendChild(style);
    document.body.appendChild(overlay);

    // Make draggable
    let isDragging = false, currentX, currentY, initialX, initialY;
    const header = overlay.querySelector('.overlay-header');

    header.addEventListener('mousedown', (e) => {
        if (e.target.closest('.overlay-controls')) return;
        initialX = e.clientX - overlay.offsetLeft;
        initialY = e.clientY - overlay.offsetTop;
        isDragging = true;
    });

    // Double-click header to toggle minimize/maximize
    header.addEventListener('dblclick', (e) => {
        if (e.target.closest('.overlay-controls')) return;
        const minimizeBtn = overlay.querySelector('.minimize-btn');
        minimizeBtn.click(); // Trigger the minimize button
    });

    document.addEventListener('mousemove', (e) => {
        if (isDragging) {
            e.preventDefault();
            overlay.style.left = (e.clientX - initialX) + 'px';
            overlay.style.top = (e.clientY - initialY) + 'px';
            overlay.style.right = 'auto';
        }
    });

    document.addEventListener('mouseup', () => isDragging = false);

    const minimizeBtn = overlay.querySelector('.minimize-btn');
    minimizeBtn.addEventListener('click', () => {
        overlay.classList.toggle('minimized');
        // Change button text based on state
        if (overlay.classList.contains('minimized')) {
            minimizeBtn.textContent = '+';
            minimizeBtn.title = 'Maximize';
        } else {
            minimizeBtn.textContent = '−';
            minimizeBtn.title = 'Minimize';
        }
    });

    overlay.querySelector('.close-btn').addEventListener('click', () => {
        if (window.audioAnalyzer) {
            window.audioAnalyzer.stop();
        }
        overlay.remove();
        // Clean up but audio will keep playing
    });

    // Initialize analyzer
    window.audioAnalyzer = new AudioAnalyzer();
}

// Auto-run
const existing = document.getElementById('audio-analyzer-overlay');
if (existing) {
    existing.remove();
}

createOverlay();

})(); // Close the main wrapper function
