// Provider factory: uses OpenAI-compatible adapter only when a key is available
// at runtime (dev .env or server-injected). Otherwise local fallback. No hard-coding.
import type { AIProvider } from '../../types';
import { LocalFallbackProvider, OpenAICompatibleProvider } from './providers';
import { CRITIC_PROMPT, SIGNAL_REASONING_PROMPT } from '../../agents/prompts';

declare global {
  interface Window { __SUNIL_AI__?: { apiKey?: string; model?: string; baseUrl?: string } }
}

export function getAIProvider(): AIProvider {
  const runtime = typeof window !== 'undefined' ? window.__SUNIL_AI__ : undefined;
  // Vite exposes only VITE_* vars; AI keys should come from a backend proxy in production.
  // For local dev, an optional VITE_AI_* escape hatch is supported but never committed.
  const apiKey = runtime?.apiKey || (import.meta.env.VITE_AI_API_KEY as string | undefined) || '';
  const model = runtime?.model || (import.meta.env.VITE_AI_MODEL as string | undefined) || 'gpt-4o-mini';
  const baseUrl = runtime?.baseUrl || (import.meta.env.VITE_AI_BASE_URL as string | undefined) || 'https://api.openai.com/v1';
  if (apiKey) {
    return new OpenAICompatibleProvider({ apiKey, model, baseUrl }, { analyst: SIGNAL_REASONING_PROMPT, critic: CRITIC_PROMPT });
  }
  return new LocalFallbackProvider();
}
