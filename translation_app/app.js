class AudioCaptureAnalyzer {
    constructor() {
        this.mediaStream = null;
        this.audioContext = null;
        this.analyser = null;
        this.source = null;
        this.animationId = null;

        // Canvas elements
        this.waveformCanvas = document.getElementById('waveformCanvas');
        this.spectrumCanvas = document.getElementById('spectrumCanvas');
        this.waveformCtx = this.waveformCanvas.getContext('2d');
        this.spectrumCtx = this.spectrumCanvas.getContext('2d');

        // UI elements
        this.startBtn = document.getElementById('startBtn');
        this.stopBtn = document.getElementById('stopBtn');
        this.statusText = document.getElementById('statusText');
        this.volumeMeter = document.getElementById('volumeMeter');
        this.volumeText = document.getElementById('volumeText');
        this.peakFreq = document.getElementById('peakFreq');
        this.avgVolume = document.getElementById('avgVolume');
        this.sampleRate = document.getElementById('sampleRate');
        this.channels = document.getElementById('channels');

        this.initializeCanvases();
        this.setupEventListeners();
    }

    initializeCanvases() {
        // Set canvas sizes
        this.waveformCanvas.width = this.waveformCanvas.offsetWidth;
        this.waveformCanvas.height = 200;
        this.spectrumCanvas.width = this.spectrumCanvas.offsetWidth;
        this.spectrumCanvas.height = 200;

        // Handle window resize
        window.addEventListener('resize', () => {
            this.waveformCanvas.width = this.waveformCanvas.offsetWidth;
            this.spectrumCanvas.width = this.spectrumCanvas.offsetWidth;
        });
    }

    setupEventListeners() {
        this.startBtn.addEventListener('click', () => this.startCapture());
        this.stopBtn.addEventListener('click', () => this.stopCapture());
    }

    async startCapture() {
        try {
            this.updateStatus('Requesting permission...', 'warning');

            // Request display media with audio
            this.mediaStream = await navigator.mediaDevices.getDisplayMedia({
                video: true, // Required for tab capture
                audio: {
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false
                }
            });

            // Check if audio track exists
            const audioTracks = this.mediaStream.getAudioTracks();
            if (audioTracks.length === 0) {
                throw new Error('No audio track found. Make sure to check "Share audio" when selecting the tab.');
            }

            // Create audio context and analyser
            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 2048;
            this.analyser.smoothingTimeConstant = 0.8;

            // Create media stream source
            this.source = this.audioContext.createMediaStreamSource(this.mediaStream);
            this.source.connect(this.analyser);

            // Update UI
            this.startBtn.disabled = true;
            this.stopBtn.disabled = false;
            this.updateStatus('Capturing audio...', 'success');

            // Update audio info
            this.sampleRate.textContent = `${this.audioContext.sampleRate} Hz`;
            this.channels.textContent = audioTracks[0].getSettings().channelCount || 'N/A';

            // Start visualization
            this.visualize();

            // Handle stream end
            this.mediaStream.getVideoTracks()[0].addEventListener('ended', () => {
                this.stopCapture();
            });

        } catch (error) {
            console.error('Error starting capture:', error);
            this.updateStatus(`Error: ${error.message}`, 'error');
            this.resetUI();
        }
    }

    stopCapture() {
        // Stop all tracks
        if (this.mediaStream) {
            this.mediaStream.getTracks().forEach(track => track.stop());
            this.mediaStream = null;
        }

        // Disconnect audio nodes
        if (this.source) {
            this.source.disconnect();
            this.source = null;
        }

        // Close audio context
        if (this.audioContext) {
            this.audioContext.close();
            this.audioContext = null;
        }

        // Cancel animation
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }

        // Reset UI
        this.resetUI();
        this.updateStatus('Stopped', 'info');

        // Clear canvases
        this.clearCanvases();
    }

    visualize() {
        const bufferLength = this.analyser.frequencyBinCount;
        const timeData = new Uint8Array(bufferLength);
        const freqData = new Uint8Array(bufferLength);

        const draw = () => {
            this.animationId = requestAnimationFrame(draw);

            // Get audio data
            this.analyser.getByteTimeDomainData(timeData);
            this.analyser.getByteFrequencyData(freqData);

            // Draw visualizations
            this.drawWaveform(timeData);
            this.drawSpectrum(freqData);
            this.updateVolumeLevel(timeData);
            this.updateAnalysisData(freqData, timeData);
        };

        draw();
    }

    drawWaveform(dataArray) {
        const canvas = this.waveformCanvas;
        const ctx = this.waveformCtx;
        const width = canvas.width;
        const height = canvas.height;

        // Clear canvas
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, width, height);

        // Draw waveform
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#00ff88';
        ctx.beginPath();

        const sliceWidth = width / dataArray.length;
        let x = 0;

        for (let i = 0; i < dataArray.length; i++) {
            const v = dataArray[i] / 128.0;
            const y = (v * height) / 2;

            if (i === 0) {
                ctx.moveTo(x, y);
            } else {
                ctx.lineTo(x, y);
            }

            x += sliceWidth;
        }

        ctx.lineTo(width, height / 2);
        ctx.stroke();

        // Draw center line
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, height / 2);
        ctx.lineTo(width, height / 2);
        ctx.stroke();
    }

    drawSpectrum(dataArray) {
        const canvas = this.spectrumCanvas;
        const ctx = this.spectrumCtx;
        const width = canvas.width;
        const height = canvas.height;

        // Clear canvas
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(0, 0, width, height);

        // Draw frequency bars
        const barWidth = (width / dataArray.length) * 2.5;
        let x = 0;

        for (let i = 0; i < dataArray.length; i++) {
            const barHeight = (dataArray[i] / 255) * height;

            // Create gradient
            const gradient = ctx.createLinearGradient(0, height - barHeight, 0, height);
            gradient.addColorStop(0, '#ff006e');
            gradient.addColorStop(0.5, '#8338ec');
            gradient.addColorStop(1, '#3a86ff');

            ctx.fillStyle = gradient;
            ctx.fillRect(x, height - barHeight, barWidth, barHeight);

            x += barWidth + 1;
        }
    }

    updateVolumeLevel(dataArray) {
        // Calculate RMS volume
        let sum = 0;
        for (let i = 0; i < dataArray.length; i++) {
            const normalized = (dataArray[i] - 128) / 128;
            sum += normalized * normalized;
        }
        const rms = Math.sqrt(sum / dataArray.length);
        const db = 20 * Math.log10(rms);

        // Update volume meter (normalize to 0-100%)
        const normalizedVolume = Math.max(0, Math.min(100, (db + 60) * (100 / 60)));
        this.volumeMeter.style.width = normalizedVolume + '%';

        // Color based on volume level
        if (normalizedVolume > 80) {
            this.volumeMeter.style.backgroundColor = '#ff006e';
        } else if (normalizedVolume > 50) {
            this.volumeMeter.style.backgroundColor = '#ffbe0b';
        } else {
            this.volumeMeter.style.backgroundColor = '#00ff88';
        }

        // Update text
        this.volumeText.textContent = db > -60 ? db.toFixed(1) + ' dB' : '-∞ dB';
    }

    updateAnalysisData(freqData, timeData) {
        // Find peak frequency
        let maxValue = 0;
        let maxIndex = 0;
        for (let i = 0; i < freqData.length; i++) {
            if (freqData[i] > maxValue) {
                maxValue = freqData[i];
                maxIndex = i;
            }
        }

        const nyquist = this.audioContext.sampleRate / 2;
        const peakFrequency = (maxIndex * nyquist) / freqData.length;
        this.peakFreq.textContent = peakFrequency.toFixed(1) + ' Hz';

        // Calculate average volume
        let sum = 0;
        for (let i = 0; i < timeData.length; i++) {
            const normalized = (timeData[i] - 128) / 128;
            sum += normalized * normalized;
        }
        const rms = Math.sqrt(sum / timeData.length);
        const db = 20 * Math.log10(rms);
        this.avgVolume.textContent = db > -60 ? db.toFixed(1) + ' dB' : '-∞ dB';
    }

    updateStatus(message, type) {
        this.statusText.textContent = message;
        this.statusText.className = 'status-' + type;
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

        this.volumeMeter.style.width = '0%';
        this.volumeText.textContent = '0 dB';
        this.peakFreq.textContent = '0 Hz';
        this.avgVolume.textContent = '0 dB';
    }
}

// Initialize the app when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    new AudioCaptureAnalyzer();
});
