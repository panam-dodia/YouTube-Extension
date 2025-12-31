// API Client for Backend Communication

const API_URL = 'http://localhost:8080'; // Change this when deploying

const api = {
  /**
   * Translate text to target language
   */
  async translateText(text, targetLanguage) {
    const response = await fetch(`${API_URL}/api/translation/translate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text, targetLanguage })
    });

    if (!response.ok) {
      throw new Error(`Translation failed: ${response.statusText}`);
    }

    return await response.json();
  },

  /**
   * Convert text to speech
   */
  async textToSpeech(text, gender = 'male', language = 'English') {
    const response = await fetch(`${API_URL}/api/translation/text-to-speech`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ text, gender, language })
    });

    if (!response.ok) {
      throw new Error(`TTS failed: ${response.statusText}`);
    }

    // Return audio as blob
    return await response.blob();
  },

  /**
   * Answer question about video
   */
  async answerQuestion(question, transcript, targetLanguage = 'English') {
    const response = await fetch(`${API_URL}/api/translation/qa`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ question, transcript, targetLanguage })
    });

    if (!response.ok) {
      throw new Error(`Q&A failed: ${response.statusText}`);
    }

    return await response.json();
  },

  /**
   * Detect speaker gender from transcript
   */
  async detectGender(transcriptSample) {
    const response = await fetch(`${API_URL}/api/translation/detect-gender`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ transcriptSample })
    });

    if (!response.ok) {
      throw new Error(`Gender detection failed: ${response.statusText}`);
    }

    return await response.json();
  }
};
