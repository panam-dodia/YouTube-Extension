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

export default router;
