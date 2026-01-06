// AudioAnalyzer class definition FIRST
class AudioAnalyzer {
    constructor() {
        this.audioContext = null;
        this.analyser = null;
        this.source = null;
        this.animationId = null;
        this.mediaElement = null;
        this.recognition = null;

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

        this.initializeCanvases();
        this.setupEventListeners();
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
        document.getElementById('clear-transcript-btn').addEventListener('click', () => {
            this.transcriptionBox.innerHTML = '<div class="transcript-placeholder">Transcription will appear here...</div>';
        });
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
            this.updateStatus('Searching for audio...', 'warning');

            const mediaElements = this.findMediaElements();

            console.log('Media elements found:', mediaElements);

            if (mediaElements.length === 0) {
                this.updateStatus('No audio/video found on page!', 'error');
                setTimeout(() => this.updateStatus('Ready to capture', 'info'), 3000);
                return;
            }

            this.mediaElement = mediaElements[0];

            console.log('Using element:', this.mediaElement);

            this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            this.analyser = this.audioContext.createAnalyser();
            this.analyser.fftSize = 2048;
            this.analyser.smoothingTimeConstant = 0.8;

            if (!this.mediaElement._audioSource) {
                this.source = this.audioContext.createMediaElementSource(this.mediaElement);
                this.mediaElement._audioSource = this.source;
                this.source.connect(this.analyser);
                this.source.connect(this.audioContext.destination);
            } else {
                this.source = this.mediaElement._audioSource;
                this.source.connect(this.analyser);
            }

            this.startBtn.disabled = true;
            this.stopBtn.disabled = false;
            this.updateStatus('● Capturing audio & transcribing', 'success');

            const sourceType = this.mediaElement.tagName.toLowerCase();
            this.sourceText.textContent = sourceType === 'video' ? 'Video' : 'Audio';

            this.visualize();
            this.startTranscription();

        } catch (error) {
            console.error('Full error:', error);
            console.error('Error name:', error.name);
            console.error('Error message:', error.message);

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

    startTranscription() {
        if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
            this.addTranscriptLine('Speech recognition not supported in this browser', true);
            return;
        }

        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        this.recognition = new SpeechRecognition();
        this.recognition.continuous = true;
        this.recognition.interimResults = true;
        this.recognition.lang = 'en-US';

        this.recognition.onresult = (event) => {
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const transcript = event.results[i][0].transcript;
                const isFinal = event.results[i].isFinal;

                if (isFinal) {
                    this.addTranscriptLine(transcript, false);
                }
            }
        };

        this.recognition.onerror = (event) => {
            console.error('Speech recognition error:', event.error);
        };

        this.recognition.onend = () => {
            if (this.stopBtn.disabled === false) {
                this.recognition.start();
            }
        };

        try {
            this.recognition.start();
        } catch (e) {
            console.error('Could not start recognition:', e);
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

    stop() {
        if (this.source) {
            try { this.source.disconnect(this.analyser); } catch(e) {}
        }
        if (this.analyser) this.analyser = null;
        if (this.audioContext && this.audioContext.state !== 'closed') {
            this.audioContext.close();
            this.audioContext = null;
        }
        if (this.animationId) {
            cancelAnimationFrame(this.animationId);
            this.animationId = null;
        }
        if (this.recognition) {
            this.recognition.stop();
            this.recognition = null;
        }

        this.mediaElement = null;
        this.source = null;
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

        this.volumeBar.style.width = '0%';
        this.volumeText.textContent = '0 dB';
        this.peakFreq.textContent = '0 Hz';
        this.avgVolume.textContent = '0 dB';
        this.sourceText.textContent = 'None';
    }
}

// createOverlay function SECOND
function createOverlay() {
    const overlay = document.createElement('div');
    overlay.id = 'audio-analyzer-overlay';
    overlay.innerHTML = `
        <div class="overlay-header">
            <div class="overlay-title">
                <span>🎵</span> Audio Analyzer & Transcription
            </div>
            <div class="overlay-controls">
                <button class="control-btn minimize-btn" title="Minimize">−</button>
                <button class="control-btn close-btn" title="Close">×</button>
            </div>
        </div>
        <div class="overlay-content">
            <div class="overlay-buttons">
                <button id="overlay-start-btn" class="overlay-btn btn-start">Start Capture</button>
                <button id="overlay-stop-btn" class="overlay-btn btn-stop" disabled>Stop</button>
            </div>
            <div class="overlay-status">
                <span id="overlay-status-text">Ready to capture</span>
            </div>

            <div class="transcription-section">
                <div class="transcription-header">
                    <span>📝 Live Transcription</span>
                    <button id="clear-transcript-btn" class="small-btn">Clear</button>
                </div>
                <div id="transcription-box" class="transcription-box">
                    <div class="transcript-placeholder">Transcription will appear here...</div>
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
            padding: 4px 8px;
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
            min-height: 120px;
            max-height: 200px;
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

        .transcript-line.interim {
            opacity: 0.6;
            font-style: italic;
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

    document.addEventListener('mousemove', (e) => {
        if (isDragging) {
            e.preventDefault();
            overlay.style.left = (e.clientX - initialX) + 'px';
            overlay.style.top = (e.clientY - initialY) + 'px';
            overlay.style.right = 'auto';
        }
    });

    document.addEventListener('mouseup', () => isDragging = false);

    overlay.querySelector('.minimize-btn').addEventListener('click', () => {
        overlay.classList.toggle('minimized');
    });

    overlay.querySelector('.close-btn').addEventListener('click', () => {
        if (window.audioAnalyzer?.audioContext) {
            window.audioAnalyzer.stop();
        }
        overlay.remove();
    });

    // Initialize analyzer - NOW it can find the AudioAnalyzer class!
    window.audioAnalyzer = new AudioAnalyzer();
}

// Auto-run LAST
(function() {
    const existing = document.getElementById('audio-analyzer-overlay');
    if (existing) {
        existing.remove();
        return;
    }

    createOverlay();
})();
