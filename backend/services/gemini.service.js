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
      const prompt = `Analyze this video transcript and determine the speaker's gender ONLY if there are EXPLICIT indicators.

Transcript sample:
${transcriptSample}

Look for EXPLICIT indicators ONLY:
1. Direct self-references: "I am a man/woman", "as a male/female", etc.
2. Clear pronoun usage: "he/him" or "she/her" when referring to the speaker
3. Gendered titles: Mr., Mrs., Ms., Sir, Madam, etc.

IMPORTANT:
- If there are NO explicit gender indicators, respond with "male" (default)
- Do NOT guess based on topic, interests, or speech patterns
- ONLY detect gender if it's explicitly stated

Respond with ONLY ONE WORD: either "male" or "female"

Answer:`;

      const result = await this.model.generateContent(prompt);
      const response = await result.response;
      const gender = response.text().trim().toLowerCase();

      if (gender.includes('female')) {
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
