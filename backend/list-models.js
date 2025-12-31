// List available Gemini models
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

dotenv.config();

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) {
  console.error('❌ GEMINI_API_KEY not found in .env file');
  process.exit(1);
}

const genAI = new GoogleGenerativeAI(apiKey);

async function listModels() {
  try {
    console.log('🔍 Fetching available models...\n');

    // Use fetch to get models list
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
    );

    const data = await response.json();

    if (data.models) {
      console.log(`✅ Found ${data.models.length} models:\n`);

      data.models.forEach(model => {
        console.log(`📦 ${model.name}`);
        console.log(`   Display Name: ${model.displayName}`);
        console.log(`   Supported Methods: ${model.supportedGenerationMethods?.join(', ') || 'N/A'}`);
        console.log('');
      });

      console.log('\n🎯 Models that support generateContent:');
      const generateModels = data.models.filter(m =>
        m.supportedGenerationMethods?.includes('generateContent')
      );

      generateModels.forEach(model => {
        console.log(`   - ${model.name.replace('models/', '')}`);
      });

    } else {
      console.error('❌ No models found');
      console.log('Response:', JSON.stringify(data, null, 2));
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

listModels();
