/**
 * OpenRouter Model Ratings & Benchmark Registry
 * Fetches and matches live ratings directly from OpenRouter's /api/v1/models endpoint.
 */

export interface OpenRouterBenchmarkMetrics {
  intelligence_index?: number;
  coding_index?: number;
  agentic_index?: number;
}

export interface OpenRouterModelCard {
  id: string;
  name: string;
  canonical_slug?: string;
  context_length: number;
  pricing?: {
    prompt: string;
    completion: string;
    input_cache_read?: string;
  };
  benchmarks?: {
    artificial_analysis?: OpenRouterBenchmarkMetrics;
    design_arena?: any[];
  };
}

export interface ModelMatchResult {
  matched: boolean;
  score: number;
  matched_model?: OpenRouterModelCard;
  metrics?: OpenRouterBenchmarkMetrics;
  status: 'success' | 'fail';
}

// In-memory cache for OpenRouter models API response
let cachedORModels: OpenRouterModelCard[] | null = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 1000 * 60 * 30; // 30 minutes

/**
 * Fetch all models with live ratings from OpenRouter API
 */
export async function fetchOpenRouterModels(apiKey?: string): Promise<OpenRouterModelCard[]> {
  const now = Date.now();
  if (cachedORModels && (now - lastFetchTime < CACHE_TTL_MS)) {
    return cachedORModels;
  }

  const effectiveKey = apiKey || process.env.OPEN_ROUTER_API_KEY;
  const headers: Record<string, string> = {};
  if (effectiveKey) {
    headers['Authorization'] = `Bearer ${effectiveKey}`;
  }

  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers,
      next: { revalidate: 1800 },
    });

    if (!res.ok) {
      throw new Error(`OpenRouter API responded with status ${res.status}`);
    }

    const json: any = await res.json();
    if (Array.isArray(json.data) && json.data.length > 0) {
      cachedORModels = json.data;
      lastFetchTime = now;
      return cachedORModels!;
    }
  } catch (err) {
    console.error('[OpenRouter Benchmarks] Failed to fetch live models from OpenRouter:', err);
  }

  // Fallback to cached if available
  if (cachedORModels) return cachedORModels;

  // Static fallback dataset in case of network unavailability
  return STATIC_FALLBACK_MODELS;
}

function cleanStr(s: string): string {
  return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Match any configured model ID, model string, or hint against OpenRouter models
 */
export function matchOpenRouterModel(
  modelId: string,
  modelString: string,
  hint?: string,
  availableModels: OpenRouterModelCard[] = cachedORModels || STATIC_FALLBACK_MODELS
): ModelMatchResult {
  const targets = [modelString, modelId, hint].filter(Boolean) as string[];

  // 1. Exact ID or canonical_slug match
  for (const t of targets) {
    const direct = availableModels.find((m) => m.id === t || m.canonical_slug === t);
    if (direct) {
      return {
        matched: true,
        score: 1.0,
        matched_model: direct,
        metrics: direct.benchmarks?.artificial_analysis,
        status: 'success',
      };
    }
  }

  // 2. Cleaned target substring matching
  for (const t of targets) {
    const tClean = cleanStr(t);
    if (tClean.length < 3) continue;
    const found = availableModels.find((m) => {
      const idClean = cleanStr(m.id);
      const slugClean = cleanStr(m.canonical_slug || '');
      const nameClean = cleanStr(m.name || '');
      return idClean.includes(tClean) || tClean.includes(idClean) || nameClean.includes(tClean);
    });
    if (found) {
      return {
        matched: true,
        score: 0.9,
        matched_model: found,
        metrics: found.benchmarks?.artificial_analysis,
        status: 'success',
      };
    }
  }

  // 3. Token overlap similarity
  let best: OpenRouterModelCard | null = null;
  let bestScore = 0;
  for (const t of targets) {
    const tokens = new Set(t.toLowerCase().split(/[\s\-_/:]+/));
    for (const m of availableModels) {
      const mTokens = new Set(`${m.id} ${m.name || ''}`.toLowerCase().split(/[\s\-_/:]+/));
      let common = 0;
      for (const tok of tokens) {
        if (mTokens.has(tok)) common++;
      }
      const score = (2 * common) / (tokens.size + mTokens.size);
      if (score > bestScore && score > 0.38) {
        bestScore = score;
        best = m;
      }
    }
  }

  if (best) {
    return {
      matched: true,
      score: bestScore,
      matched_model: best,
      metrics: best.benchmarks?.artificial_analysis,
      status: 'success',
    };
  }

  return {
    matched: false,
    score: 0,
    status: 'fail',
  };
}

/**
 * Static baseline fallback dataset if OpenRouter API is temporarily unreachable
 */
export const STATIC_FALLBACK_MODELS: OpenRouterModelCard[] = [
  {
    id: 'google/gemini-3.7-flash',
    name: 'Google: Gemini 3.7 Flash',
    context_length: 1048576,
    benchmarks: {
      artificial_analysis: {
        intelligence_index: 56.0,
        coding_index: 76.1,
        agentic_index: 45.1,
      },
    },
  },
  {
    id: 'z-ai/glm-5.2',
    name: 'Z.ai: GLM 5.2',
    context_length: 1310720,
    benchmarks: {
      artificial_analysis: {
        intelligence_index: 52.6,
        coding_index: 68.8,
        agentic_index: 45.7,
      },
    },
  },
  {
    id: 'google/gemini-3.6-flash',
    name: 'Google: Gemini 3.6 Flash',
    context_length: 1048576,
    benchmarks: {
      artificial_analysis: {
        intelligence_index: 51.6,
        coding_index: 69.2,
        agentic_index: 40.5,
      },
    },
  },
  {
    id: 'deepseek/deepseek-v4-pro',
    name: 'DeepSeek: DeepSeek V4 Pro 0423',
    context_length: 163840,
    benchmarks: {
      artificial_analysis: {
        intelligence_index: 45.3,
        coding_index: 59.4,
        agentic_index: 37.8,
      },
    },
  },
  {
    id: 'nvidia/nemotron-3-ultra-550b-a55b',
    name: 'NVIDIA: Nemotron 3 Ultra',
    context_length: 131072,
    benchmarks: {
      artificial_analysis: {
        intelligence_index: 38.3,
        coding_index: 49.3,
        agentic_index: 27.5,
      },
    },
  },
  {
    id: 'qwen/qwen3.6-27b',
    name: 'Qwen: Qwen3.6 27B',
    context_length: 131072,
    benchmarks: {
      artificial_analysis: {
        intelligence_index: 37.7,
        coding_index: 53.7,
        agentic_index: 27.5,
      },
    },
  },
  {
    id: 'google/gemini-3.5-flash-lite',
    name: 'Google: Gemini 3.5 Flash Lite',
    context_length: 1048576,
    benchmarks: {
      artificial_analysis: {
        intelligence_index: 37.4,
        coding_index: 49.3,
        agentic_index: 27.2,
      },
    },
  },
  {
    id: 'google/gemma-4-31b-it',
    name: 'Google: Gemma 4 31B',
    context_length: 131072,
    benchmarks: {
      artificial_analysis: {
        intelligence_index: 29.7,
        coding_index: 43.4,
        agentic_index: 14.4,
      },
    },
  },
  {
    id: 'google/gemma-4-26b-a4b-it',
    name: 'Google: Gemma 4 26B A4B',
    context_length: 262144,
    benchmarks: {
      artificial_analysis: {
        intelligence_index: 26.1,
        coding_index: 39.3,
        agentic_index: 11.0,
      },
    },
  },
  {
    id: 'nvidia/nemotron-3-super-120b-a12b',
    name: 'NVIDIA: Nemotron 3 Super',
    context_length: 131072,
    benchmarks: {
      artificial_analysis: {
        intelligence_index: 25.7,
        coding_index: 37.7,
        agentic_index: 8.8,
      },
    },
  },
  {
    id: 'google/gemini-3.1-flash-lite-preview',
    name: 'Google: Gemini 3.1 Flash Lite Preview',
    context_length: 1048576,
    benchmarks: {
      artificial_analysis: {
        intelligence_index: 25.6,
        coding_index: 34.7,
        agentic_index: 6.5,
      },
    },
  },
  {
    id: 'openai/gpt-oss-120b',
    name: 'OpenAI: gpt-oss-120b',
    context_length: 131072,
    benchmarks: {
      artificial_analysis: {
        intelligence_index: 24.1,
        coding_index: 30.4,
        agentic_index: 13.4,
      },
    },
  },
  {
    id: 'openai/gpt-oss-20b',
    name: 'OpenAI: gpt-oss-20b',
    context_length: 131072,
    benchmarks: {
      artificial_analysis: {
        intelligence_index: 15.2,
        coding_index: 20.7,
        agentic_index: 3.1,
      },
    },
  },
];
