import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

class GeminiService {
  constructor() {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY not found in environment variables');
    }

    this.genAI = new GoogleGenerativeAI(apiKey);
    // Using gemini-2.0-flash-lite which has separate quota from gemini-2.0-flash
    // This is a lighter, faster model optimized for simple tasks like translation
    this.model = this.genAI.getGenerativeModel({ model: 'gemini-2.0-flash-lite' });
    console.log('✅ Gemini service initialized with gemini-2.0-flash-lite');
  }

  /**
   * Translate text to target language using Gemini
   */
  async translateText(text, targetLanguage) {
    try {
      const prompt = `Translate the following text to ${targetLanguage}. Only return the translation, no explanations:

${text}`;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      return response.text().trim();
    } catch (error) {
      console.error('Translation error:', error.message);
      throw new Error(`Failed to translate: ${error.message}`);
    }
  }

  /**
   * Answer a question based on video transcript AND general knowledge
   */
  async answerQuestion(question, transcript, targetLanguage = 'English') {
    try {
      const transcriptText = Array.isArray(transcript)
        ? transcript.map(seg => seg.text).join(' ')
        : transcript;

      const prompt = `You are a helpful AI assistant that can answer questions about a YouTube video AND provide general knowledge.

Video Transcript (for context):
${transcriptText}

User's Question: ${question}

Instructions:
1. First, check if the question is about the video content - if so, answer using the transcript
2. If the question is asking for more information about something mentioned in the video (like "what does X look like?", "tell me more about X"), provide general knowledge
3. If the question is completely unrelated to the video, you can still answer it using your general knowledge
4. When providing general information that's not in the video, you can mention relevant resources or Wikipedia links
5. Answer in ${targetLanguage} language
6. Keep your answer concise and helpful (2-5 sentences)
7. If you mention a visual resource (image, diagram), provide a link format like: "You can see images here: https://en.wikipedia.org/wiki/[Topic]"

Answer:`;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      return response.text().trim();
    } catch (error) {
      console.error('Gemini API error:', error.message);
      throw new Error(`Failed to generate answer: ${error.message}`);
    }
  }

  /**
   * Detect voice gender from transcript sample
   */
  async detectVoiceGender(transcriptSample) {
    try {
      const prompt = `Analyze this video transcript and determine the most likely speaker's gender based on multiple factors.

Transcript sample:
${transcriptSample}

Consider these indicators (in order of importance):

1. EXPLICIT INDICATORS (highest confidence):
   - Direct self-references: "I am a man/woman", "as a male/female", "I'm a guy/girl"
   - Gendered titles: Mr., Mrs., Ms., Sir, Madam, gentleman, lady
   - Gendered roles/positions: "actress", "waitress", "businessman", etc.
   - Self-descriptive pronouns: "he/him" or "she/her" when referring to themselves

2. CONTEXTUAL INDICATORS (medium confidence):
   - Topics typically associated with gender (e.g., pregnancy, military service, sports leagues)
   - Personal experiences shared (e.g., "when I was pregnant", "my husband/wife")
   - Gendered product reviews (makeup, shaving, etc.)
   - Gendered professions or roles mentioned as their own

3. LINGUISTIC PATTERNS (lower confidence, use as tiebreaker):
   - Communication style and word choices
   - Use of intensifiers, hedging, or emotional language
   - Topic of discussion and presentation style

DECISION RULES:
- If explicit indicators are present → use those (highest confidence)
- If strong contextual clues exist → use those (medium confidence)
- If only linguistic patterns → make best inference (lower confidence)
- If truly ambiguous or unclear → default to "male"

IMPORTANT:
- Consider ALL available evidence, not just one type
- Even subtle contextual clues can be valuable
- The goal is accuracy, not certainty - make the best inference possible
- Consider that the speaker might be talking ABOUT themselves, not just using neutral language

Analyze the transcript and respond with ONLY ONE WORD: either "male" or "female"

Answer:`;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const gender = response.text().trim().toLowerCase();

      if (gender.includes('female') || gender.includes('woman')) {
        return 'female';
      } else {
        return 'male';
      }
    } catch (error) {
      console.error('Voice gender detection error:', error.message);
      return 'male'; // Default fallback
    }
  }
}

export default new GeminiService();
