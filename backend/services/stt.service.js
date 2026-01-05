import speech from '@google-cloud/speech';
import { Readable } from 'stream';

const client = new speech.SpeechClient();

/**
 * Supported languages for speech recognition
 */
export const SUPPORTED_LANGUAGES = {
  en: 'en-US',
  hi: 'hi-IN',
  es: 'es-ES',
  fr: 'fr-FR',
  de: 'de-DE',
  ja: 'ja-JP',
  pt: 'pt-BR',
  zh: 'zh-CN',
  ko: 'ko-KR',
  it: 'it-IT',
  ru: 'ru-RU',
  ar: 'ar-SA',
  tr: 'tr-TR',
  nl: 'nl-NL',
  pl: 'pl-PL'
};

/**
 * Transcribe audio buffer to text
 * @param {Buffer} audioBuffer - Audio data in WebM/Opus format
 * @param {string} languageCode - Source language code (e.g., 'en', 'hi')
 * @returns {Promise<{transcript: string, confidence: number, language: string}>}
 */
export async function transcribeAudio(audioBuffer, languageCode = 'en') {
  try {
    console.log(`[STT] Transcribing audio: ${audioBuffer.length} bytes, language: ${languageCode}`);

    const gcpLanguageCode = SUPPORTED_LANGUAGES[languageCode] || 'en-US';

    const audio = {
      content: audioBuffer.toString('base64'),
    };

    const config = {
      encoding: 'WEBM_OPUS',
      sampleRateHertz: 48000,
      audioChannelCount: 2, // Stereo audio (desktop capture sends 2 channels)
      languageCode: gcpLanguageCode,
      enableAutomaticPunctuation: true,
      model: 'latest_short', // Use short model for live transcription
      useEnhanced: true,
      // Add speech context for better accuracy
      speechContexts: [{
        phrases: [],
        boost: 20
      }]
    };

    const request = {
      audio: audio,
      config: config,
    };

    const [response] = await client.recognize(request);

    console.log('[STT] Response received:', {
      hasResults: !!response.results,
      resultCount: response.results?.length || 0
    });

    if (!response.results || response.results.length === 0) {
      console.log('[STT] No speech detected in audio');
      return { transcript: '', confidence: 0, language: languageCode };
    }

    const transcription = response.results
      .map(result => result.alternatives[0])
      .filter(alt => alt && alt.transcript)
      .map(alt => ({
        transcript: alt.transcript,
        confidence: alt.confidence || 0
      }));

    if (transcription.length === 0) {
      console.log('[STT] No valid transcription alternatives found');
      return { transcript: '', confidence: 0, language: languageCode };
    }

    // Combine all transcripts
    const fullTranscript = transcription.map(t => t.transcript).join(' ');
    const avgConfidence = transcription.reduce((sum, t) => sum + t.confidence, 0) / transcription.length;

    console.log('[STT] Transcription successful:', {
      transcript: fullTranscript,
      confidence: avgConfidence,
      length: fullTranscript.length
    });

    return {
      transcript: fullTranscript,
      confidence: avgConfidence,
      language: languageCode
    };
  } catch (error) {
    console.error('[STT] Speech-to-Text error:', error);
    console.error('[STT] Error details:', {
      name: error.name,
      message: error.message,
      code: error.code,
      details: error.details
    });
    throw new Error(`Failed to transcribe audio: ${error.message}`);
  }
}

/**
 * Create a streaming recognition session
 * Returns a duplex stream for real-time transcription
 * @param {string} languageCode - Source language code
 * @param {Function} onTranscript - Callback for transcript results
 * @param {Function} onError - Callback for errors
 */
export function createStreamingRecognition(languageCode = 'en', onTranscript, onError) {
  try {
    const gcpLanguageCode = SUPPORTED_LANGUAGES[languageCode] || 'en-US';

    const request = {
      config: {
        encoding: 'WEBM_OPUS',
        sampleRateHertz: 48000,
        languageCode: gcpLanguageCode,
        enableAutomaticPunctuation: true,
        model: 'latest_short',
        useEnhanced: true,
        interimResults: true,
      },
      interimResults: true,
    };

    const recognizeStream = client
      .streamingRecognize(request)
      .on('error', (error) => {
        console.error('Streaming recognition error:', error);
        if (onError) onError(error);
      })
      .on('data', (data) => {
        if (data.results[0] && data.results[0].alternatives[0]) {
          const result = data.results[0].alternatives[0];
          const isFinal = data.results[0].isFinal;

          if (onTranscript) {
            onTranscript({
              transcript: result.transcript,
              confidence: result.confidence || 0,
              isFinal: isFinal,
              language: languageCode
            });
          }
        }
      });

    return recognizeStream;
  } catch (error) {
    console.error('Failed to create streaming recognition:', error);
    throw error;
  }
}

/**
 * Detect the language of the audio
 * @param {Buffer} audioBuffer - Audio data
 * @returns {Promise<string>} - Detected language code
 */
export async function detectLanguage(audioBuffer) {
  try {
    const audio = {
      content: audioBuffer.toString('base64'),
    };

    // Try recognition with language detection
    const config = {
      encoding: 'WEBM_OPUS',
      sampleRateHertz: 48000,
      languageCode: 'en-US', // Primary language
      alternativeLanguageCodes: ['hi-IN', 'es-ES', 'fr-FR', 'de-DE', 'ja-JP', 'zh-CN'],
      enableAutomaticPunctuation: true,
      model: 'latest_short',
    };

    const request = {
      audio: audio,
      config: config,
    };

    const [response] = await client.recognize(request);

    if (response.results && response.results.length > 0) {
      const detectedLanguage = response.results[0].languageCode || 'en-US';
      // Convert GCP language code back to our format
      const langCode = Object.keys(SUPPORTED_LANGUAGES).find(
        key => SUPPORTED_LANGUAGES[key] === detectedLanguage
      ) || 'en';

      return langCode;
    }

    return 'en'; // Default fallback
  } catch (error) {
    console.error('Language detection error:', error);
    return 'en'; // Default fallback
  }
}

export default {
  transcribeAudio,
  createStreamingRecognition,
  detectLanguage,
  SUPPORTED_LANGUAGES
};
