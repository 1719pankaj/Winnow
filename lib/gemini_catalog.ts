/**
 * Google Gemini Live Model Discovery
 * Queries Google Generative Language API directly to fetch all available Gemini models.
 */

export interface GoogleGeminiApiModel {
  name: string; // e.g. "models/gemini-3.7-flash"
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
