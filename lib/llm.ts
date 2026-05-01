import OpenAI from 'openai';

export const CHATBOT_MODEL = 'anthropic/claude-sonnet-4.6';
export const CHATBOT_REASONING_EFFORT: 'low' | 'medium' | 'high' = 'medium';

export const openrouter = new OpenAI({
  apiKey: process.env.OPENROUTER_API_KEY!,
  baseURL: 'https://openrouter.ai/api/v1',
  defaultHeaders: {
    'HTTP-Referer': process.env.OPENROUTER_APP_URL ?? 'http://localhost:3000',
    'X-Title': process.env.OPENROUTER_APP_NAME ?? 'PharmaDash',
  },
});
