import { TextToSpeechClient } from '@google-cloud/text-to-speech';
import dotenv from 'dotenv';

dotenv.config();

class TTSService {
  // Voice mapping for different languages and genders
  static VOICES = {
    // English voices
    'en-male': { languageCode: 'en-US', name: 'en-US-Neural2-D', ssmlGender: 'MALE' },
    'en-female': { languageCode: 'en-US', name: 'en-US-Neural2-F', ssmlGender: 'FEMALE' },

    // Hindi voices
    'hi-male': { languageCode: 'hi-IN', name: 'hi-IN-Neural2-B', ssmlGender: 'MALE' },
    'hi-female': { languageCode: 'hi-IN', name: 'hi-IN-Neural2-A', ssmlGender: 'FEMALE' },

    // Spanish voices
    'es-male': { languageCode: 'es-US', name: 'es-US-Neural2-B', ssmlGender: 'MALE' },
    'es-female': { languageCode: 'es-US', name: 'es-US-Neural2-A', ssmlGender: 'FEMALE' },

    // French voices
    'fr-male': { languageCode: 'fr-FR', name: 'fr-FR-Neural2-B', ssmlGender: 'MALE' },
    'fr-female': { languageCode: 'fr-FR', name: 'fr-FR-Neural2-A', ssmlGender: 'FEMALE' },

    // German voices
    'de-male': { languageCode: 'de-DE', name: 'de-DE-Neural2-B', ssmlGender: 'MALE' },
    'de-female': { languageCode: 'de-DE', name: 'de-DE-Neural2-A', ssmlGender: 'FEMALE' },

    // Japanese voices
    'ja-male': { languageCode: 'ja-JP', name: 'ja-JP-Neural2-C', ssmlGender: 'MALE' },
    'ja-female': { languageCode: 'ja-JP', name: 'ja-JP-Neural2-A', ssmlGender: 'FEMALE' },

    // Portuguese voices
    'pt-male': { languageCode: 'pt-BR', name: 'pt-BR-Neural2-B', ssmlGender: 'MALE' },
    'pt-female': { languageCode: 'pt-BR', name: 'pt-BR-Neural2-A', ssmlGender: 'FEMALE' },

    // Chinese voices
    'zh-male': { languageCode: 'cmn-CN', name: 'cmn-CN-Standard-B', ssmlGender: 'MALE' },
    'zh-female': { languageCode: 'cmn-CN', name: 'cmn-CN-Standard-A', ssmlGender: 'FEMALE' },
  };

  // Language code mapping
  static LANGUAGE_CODES = {
    'english': 'en',
    'hindi': 'hi',
    'spanish': 'es',
    'french': 'fr',
    'german': 'de',
    'japanese': 'ja',
    'portuguese': 'pt',
    'chinese': 'zh',
    'mandarin': 'zh'
  };

  constructor() {
    // Initialize Google Cloud TTS client
    this.client = new TextToSpeechClient();
    console.log('✅ Google Cloud TTS service initialized');
  }

  /**
   * Get language code from language name
   */
  getLanguageCode(language) {
    const lang = language.toLowerCase().trim();
    return TTSService.LANGUAGE_CODES[lang] || 'en';
  }

  /**
   * Get appropriate voice configuration based on gender and language
   */
  getVoiceConfig(gender = 'male', language = 'English') {
    const langCode = this.getLanguageCode(language);
    const genderKey = gender.toLowerCase();
    const voiceKey = `${langCode}-${genderKey}`;

    // Return voice config or fallback to English
    return TTSService.VOICES[voiceKey] || TTSService.VOICES['en-male'];
  }

  /**
   * Convert text to speech using Google Cloud TTS
   * @param {string} text - Text to convert to speech
   * @param {string} gender - 'male' or 'female'
   * @param {string} language - Target language for voice selection
   */
  async textToSpeech(text, gender = 'male', language = 'English') {
    try {
      console.log(`🎙️ TTS Request - Gender: ${gender}, Language: ${language}`);
      console.log(`📝 Text to convert: "${text.substring(0, 100)}..."`);

      // Get voice configuration
      const voiceConfig = this.getVoiceConfig(gender, language);
      console.log(`🎙️ Selected voice: ${voiceConfig.name}`);

      // Construct the request
      const request = {
        input: { text: text },
        voice: {
          languageCode: voiceConfig.languageCode,
          name: voiceConfig.name,
          ssmlGender: voiceConfig.ssmlGender
        },
        audioConfig: {
          audioEncoding: 'MP3',
          speakingRate: 1.0,
          pitch: 0.0,
          volumeGainDb: 0.0
        }
      };

      // Perform the text-to-speech request
      const [response] = await this.client.synthesizeSpeech(request);

      if (!response.audioContent) {
        throw new Error('No audio content received from Google TTS');
      }

      console.log(`✅ Generated ${response.audioContent.length} bytes of audio`);
      return response.audioContent;
    } catch (error) {
      console.error('❌ Google Cloud TTS error:', error.message);
      throw new Error(`TTS conversion failed: ${error.message}`);
    }
  }
}

export default new TTSService();
