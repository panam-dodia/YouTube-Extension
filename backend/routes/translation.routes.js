import express from 'express';
import geminiService from '../services/gemini.service.js';
import ttsService from '../services/tts.service.js';
import sttService from '../services/stt.service.js';

const router = express.Router();

/**
 * POST /api/translation/translate
 * Translate text to target language
 */
router.post('/translate', async (req, res) => {
  try {
    const { text, targetLanguage } = req.body;

    if (!text || !targetLanguage) {
      return res.status(400).json({ error: 'Text and target language are required' });
    }

    const translatedText = await geminiService.translateText(text, targetLanguage);

    res.json({
      success: true,
      originalText: text,
      translatedText,
      targetLanguage
    });
  } catch (error) {
    console.error('Error translating text:', error);
    res.status(500).json({
      error: 'Failed to translate text',
      message: error.message
    });
  }
});

/**
 * POST /api/translation/text-to-speech
 * Convert text to speech
 */
router.post('/text-to-speech', async (req, res) => {
  try {
    const { text, gender = 'male', language = 'English' } = req.body;

    if (!text) {
      return res.status(400).json({ error: 'Text is required' });
    }

    const audioBuffer = await ttsService.textToSpeech(text, gender, language);

    // Set headers for audio response
    res.set({
      'Content-Type': 'audio/mpeg',
      'Content-Length': audioBuffer.length
    });

    res.send(audioBuffer);
  } catch (error) {
    console.error('Error converting text to speech:', error);
    res.status(500).json({
      error: 'Failed to convert text to speech',
      message: error.message
    });
  }
});

/**
 * POST /api/translation/qa
 * Answer question about video
 */
router.post('/qa', async (req, res) => {
  try {
    const { question, transcript, targetLanguage = 'English' } = req.body;

    if (!question) {
      return res.status(400).json({ error: 'Question is required' });
    }

    if (!transcript) {
      return res.status(400).json({ error: 'Transcript is required' });
    }

    const answer = await geminiService.answerQuestion(question, transcript, targetLanguage);

    res.json({
      success: true,
      question,
      answer,
      targetLanguage
    });
  } catch (error) {
    console.error('Error answering question:', error);
    res.status(500).json({
      error: 'Failed to answer question',
      message: error.message
    });
  }
});

/**
 * POST /api/translation/detect-gender
 * Detect speaker gender from transcript
 */
router.post('/detect-gender', async (req, res) => {
  try {
    const { transcriptSample } = req.body;

    if (!transcriptSample) {
      return res.status(400).json({ error: 'Transcript sample is required' });
    }

    const gender = await geminiService.detectVoiceGender(transcriptSample);

    res.json({
      success: true,
      gender
    });
  } catch (error) {
    console.error('Error detecting gender:', error);
    res.status(500).json({
      error: 'Failed to detect gender',
      message: error.message
    });
  }
});

/**
 * POST /api/translation/speech-to-text
 * Transcribe audio to text
 */
router.post('/speech-to-text', async (req, res) => {
  try {
    const { audioData, sourceLanguage = 'en' } = req.body;

    if (!audioData) {
      return res.status(400).json({ error: 'Audio data is required' });
    }

    // Convert base64 to buffer
    const audioBuffer = Buffer.from(audioData, 'base64');

    const result = await sttService.transcribeAudio(audioBuffer, sourceLanguage);

    res.json({
      success: true,
      transcript: result.transcript,
      confidence: result.confidence,
      language: result.language
    });
  } catch (error) {
    console.error('Error transcribing audio:', error);
    res.status(500).json({
      error: 'Failed to transcribe audio',
      message: error.message
    });
  }
});

/**
 * POST /api/translation/detect-language
 * Detect language from audio
 */
router.post('/detect-language', async (req, res) => {
  try {
    const { audioData } = req.body;

    if (!audioData) {
      return res.status(400).json({ error: 'Audio data is required' });
    }

    // Convert base64 to buffer
    const audioBuffer = Buffer.from(audioData, 'base64');

    const detectedLanguage = await sttService.detectLanguage(audioBuffer);

    res.json({
      success: true,
      language: detectedLanguage
    });
  } catch (error) {
    console.error('Error detecting language:', error);
    res.status(500).json({
      error: 'Failed to detect language',
      message: error.message
    });
  }
});

/**
 * POST /api/translation/translate-and-speak
 * Combined translate + TTS in a single request (saves a network round trip)
 */
router.post('/translate-and-speak', async (req, res) => {
  try {
    const { text, targetLanguage, gender = 'male' } = req.body;

    if (!text || !targetLanguage) {
      return res.status(400).json({ error: 'text and targetLanguage are required' });
    }

    // Step 1: Translate
    const translatedText = await geminiService.translateText(text, targetLanguage);

    // Step 2: Generate TTS audio
    const audioBuffer = await ttsService.textToSpeech(translatedText, gender, targetLanguage);

    // Return both translation and audio in one response
    const base64Audio = Buffer.from(audioBuffer).toString('base64');

    res.json({
      success: true,
      translatedText,
      audioData: base64Audio,
      audioSize: audioBuffer.length
    });
  } catch (error) {
    console.error('Error in translate-and-speak:', error);
    res.status(500).json({
      error: 'Failed to translate and speak',
      message: error.message
    });
  }
});

/**
 * POST /api/translation/fetch-transcript
 * Fetch YouTube caption/transcript via server-side request (bypasses browser restrictions)
 */
router.post('/fetch-transcript', async (req, res) => {
  try {
    const { videoId, captionUrl, languageCode } = req.body;

    if (!videoId) {
      return res.status(400).json({ error: 'videoId is required' });
    }

    let transcriptSegments = [];

    // Strategy 1: Use the signed caption URL from the player (most reliable)
    if (captionUrl) {
      for (const fmt of ['json3', 'srv1', '']) {
        try {
          const url = fmt ? `${captionUrl}&fmt=${fmt}` : captionUrl;
          console.log(`📝 Fetching caption URL (fmt=${fmt || 'default'}):`, url.substring(0, 100) + '...');

          const response = await fetch(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
          });

          if (response.ok) {
            const text = await response.text();
            if (text && text.length > 10) {
              const segments = parseTranscriptResponse(text, fmt || 'default');
              if (segments.length > 0) {
                console.log(`✅ Got ${segments.length} segments (fmt=${fmt || 'default'})`);
                transcriptSegments = segments;
                break;
              }
            }
          }
        } catch (e) {
          console.log(`⚠️ Failed to fetch fmt=${fmt}:`, e.message);
        }
      }
    }

    // Strategy 2: Try standard timedtext API URLs
    if (transcriptSegments.length === 0) {
      const lang = languageCode || 'hi';
      const urls = [
        `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}&fmt=json3`,
        `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}&fmt=srv1`,
        `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}&kind=asr&fmt=json3`,
        `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${lang}&kind=asr&fmt=srv1`,
      ];

      for (const url of urls) {
        try {
          console.log('📝 Trying timedtext URL:', url);
          const response = await fetch(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
          });

          if (response.ok) {
            const text = await response.text();
            if (text && text.length > 10) {
              const fmt = url.includes('json3') ? 'json3' : 'srv1';
              const segments = parseTranscriptResponse(text, fmt);
              if (segments.length > 0) {
                console.log(`✅ Got ${segments.length} segments via timedtext API`);
                transcriptSegments = segments;
                break;
              }
            }
          }
        } catch (e) {
          console.log(`⚠️ timedtext fetch failed:`, e.message);
        }
      }
    }

    if (transcriptSegments.length > 0) {
      res.json({
        success: true,
        segments: transcriptSegments,
        count: transcriptSegments.length
      });
    } else {
      res.json({
        success: false,
        segments: [],
        count: 0,
        error: 'Could not fetch transcript from any source'
      });
    }
  } catch (error) {
    console.error('Error fetching transcript:', error);
    res.status(500).json({
      error: 'Failed to fetch transcript',
      message: error.message
    });
  }
});

/**
 * Parse YouTube timedtext response (JSON3 or SRV1 XML format)
 */
function parseTranscriptResponse(text, fmt) {
  const segments = [];

  try {
    if (fmt === 'json3' || text.trim().startsWith('{')) {
      // JSON3 format
      const data = JSON.parse(text);
      const events = data.events || [];

      for (const event of events) {
        if (!event.segs) continue;
        const segText = event.segs.map(s => s.utf8 || '').join('').trim();
        if (!segText || segText === '\n') continue;

        segments.push({
          text: segText,
          start: (event.tStartMs || 0) / 1000,
          duration: (event.dDurationMs || 3000) / 1000
        });
      }
    } else if (text.trim().startsWith('<') || fmt === 'srv1') {
      // SRV1 XML format: <text start="1.23" dur="4.56">caption text</text>
      const regex = /<text\s+start="([\d.]+)"\s+dur="([\d.]+)"[^>]*>([\s\S]*?)<\/text>/g;
      let match;

      while ((match = regex.exec(text)) !== null) {
        const segText = match[3]
          .replace(/&amp;/g, '&')
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"')
          .replace(/&#39;/g, "'")
          .replace(/<[^>]+>/g, '')
          .trim();

        if (segText) {
          segments.push({
            text: segText,
            start: parseFloat(match[1]),
            duration: parseFloat(match[2])
          });
        }
      }
    }
  } catch (e) {
    console.error('Error parsing transcript:', e.message);
  }

  return segments;
}

export default router;
