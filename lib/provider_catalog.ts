/**
 * Live Model Discovery for Inference Providers:
 * - NVIDIA NIM (80+ models)
 * - Groq (14+ ultra-speed LPU models)
 * - Google Gemini (40+ models)
 */

export interface OpenAiCompatibleModel {
  id: string; // e.g. "deepseek-ai/deepseek-v4-pro-0813" or "openai/gpt-oss-120b"
  object?: string;
  created?: number;
  owned_by?: string;
  active?: boolean;
  context_window?: number;
}

export interface GoogleGeminiApiModel {
  name: string;
  version?: string;
  displayName: string;
  description?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
  supportedGenerationMethods?: string[];
  temperature?: number;
  topP?: number;
  topK?: number;
}

/**
 * Fetch live models from NVIDIA NIM API
 */
export async function fetchNimModels(apiKey?: string): Promise<OpenAiCompatibleModel[]> {
  const effectiveKey = (apiKey && !apiKey.startsWith('${')) 
    ? apiKey 
    : (process.env.NVIDIA_NIM_API_KEY || '');
  if (!effectiveKey) return [];

  try {
    const res = await fetch('https://integrate.api.nvidia.com/v1/models', {
      headers: {
        Authorization: `Bearer ${effectiveKey}`,
        'Content-Type': 'application/json',
      },
      next: { revalidate: 1800 },
    });

    if (!res.ok) {
      console.warn(`[NIM Catalog] Failed to fetch models list, status ${res.status}`);
      return [];
    }

    const json = await res.json();
    if (Array.isArray(json.data)) {
      return json.data;
    }
  } catch (err) {
    console.error('[NIM Catalog] Error querying NVIDIA NIM API:', err);
  }

  return [];
}

/**
 * Fetch live models from Groq API
 */
export async function fetchGroqModels(apiKey?: string): Promise<OpenAiCompatibleModel[]> {
  const effectiveKey = (apiKey && !apiKey.startsWith('${')) 
    ? apiKey 
    : (process.env.GROQ_KEY || '');
  if (!effectiveKey) return [];

  try {
    const res = await fetch('https://api.groq.com/openai/v1/models', {
      headers: {
        Authorization: `Bearer ${effectiveKey}`,
        'Content-Type': 'application/json',
      },
      next: { revalidate: 1800 },
    });

    if (!res.ok) {
      console.warn(`[Groq Catalog] Failed to fetch models list, status ${res.status}`);
      return [];
    }

    const json = await res.json();
    if (Array.isArray(json.data)) {
      return json.data;
    }
  } catch (err) {
    console.error('[Groq Catalog] Error querying Groq API:', err);
  }

  return [];
}

/**
 * Fetch live models from Google Gemini API
 */
export async function fetchGoogleGeminiModels(apiKey?: string): Promise<GoogleGeminiApiModel[]> {
  const effectiveKey = (apiKey && !apiKey.startsWith('${')) 
    ? apiKey 
    : (process.env.GEMINI_AI_STUDIO_KEY || process.env.GEMINI_API_KEY || '');
  if (!effectiveKey) return [];

  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${effectiveKey}`, {
      next: { revalidate: 1800 },
    });

    if (!res.ok) {
      console.warn(`[Gemini Catalog] Failed to fetch models list, status ${res.status}`);
      return [];
    }

    const json = await res.json();
    if (Array.isArray(json.models)) {
      return json.models.filter((m: GoogleGeminiApiModel) => 
        m.supportedGenerationMethods?.includes('generateContent') || 
        m.supportedGenerationMethods?.includes('embedContent')
      );
    }
  } catch (err) {
    console.error('[Gemini Catalog] Error querying Google Generative Language API:', err);
  }

  return [];
}
