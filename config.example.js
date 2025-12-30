// Configuration for YouTube Extension (Standalone)
// INSTRUCTIONS: Copy this file to 'config.js' and fill in your API keys

const CONFIG = {
  // Gemini API for Q&A (users need to add their own API key)
  GEMINI_API_KEY: '', // User will configure this in settings
  GEMINI_API_URL: 'https://generativelanguage.googleapis.com/v1beta/models/gemini-pro:generateContent',

  // YouTube Innertube API
  // This is a public YouTube API key used for fetching transcripts
  INNERTUBE_API_KEY: 'AIzaSyAO_FJ2SlqU8Q4STEHLGCilw_Y9_11qcW8',
  INNERTUBE_CLIENT_VERSION: '2.20250110.01.00',

  // Extension settings
  DEFAULT_LANGUAGE: 'English',
  MAX_TRANSCRIPT_LENGTH: 50000, // Characters
  QA_HISTORY_LIMIT: 50, // Number of Q&A pairs to store
};

// Export for use in other scripts
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONFIG;
}
