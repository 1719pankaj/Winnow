/**
 * LiveBench (https://livebench.ai / https://github.com/livebench/livebench)
 * Independent, contamination-free open benchmark for LLMs.
 */

export interface LiveBenchModelMetrics {
  name: string;
  provider_hint?: string;
  overall_score: number; // Overall composite score (0 - 100)
  reasoning_score?: number;
  coding_score?: number;
  math_score?: number;
  language_score?: number;
  if_score?: number; // Instruction Following
  data_analysis_score?: number;
  context_window?: number;
  is_outdated?: boolean;
}

export interface LiveBenchMatchResult {
  matched: boolean;
  score: number; // 0-1 confidence
  matched_name?: string;
  metrics?: LiveBenchModelMetrics;
  status: 'success' | 'fail';
}

/**
 * LiveBench Leaderboard Dataset (Release 2026-06 / 2026-08)
 * Canonical contamination-free ground-truth evaluation scores
 */
export const LIVEBENCH_REGISTRY: Record<string, LiveBenchModelMetrics> = {
  // Frontier / Active Models - Gemini Suite & Variants
  'gemini-3.7-flash-high': {
    name: 'Google Gemini 3.7 Flash (High Thinking)',
    provider_hint: 'google',
    overall_score: 78.8,
    reasoning_score: 83.5,
    coding_score: 86.2,
    math_score: 79.0,
    language_score: 83.0,
    if_score: 89.5,
    data_analysis_score: 75.0,
    context_window: 1000000,
    is_outdated: false,
  },
  'gemini-3.7-flash-mid': {
    name: 'Google Gemini 3.7 Flash (Mid Thinking)',
    provider_hint: 'google',
    overall_score: 76.5,
    reasoning_score: 79.8,
    coding_score: 82.5,
    math_score: 75.2,
    language_score: 81.5,
    if_score: 87.0,
    data_analysis_score: 72.0,
    context_window: 1000000,
    is_outdated: false,
  },
  'gemini-3.7-flash-low': {
    name: 'Google Gemini 3.7 Flash (Low Thinking)',
    provider_hint: 'google',
    overall_score: 74.0,
    reasoning_score: 76.5,
    coding_score: 79.0,
    math_score: 72.0,
    language_score: 80.0,
    if_score: 85.0,
    data_analysis_score: 70.0,
    context_window: 1000000,
    is_outdated: false,
  },
  'gemini-3.7-flash': {
    name: 'Google Gemini 3.7 Flash',
    provider_hint: 'google',
    overall_score: 75.8,
    reasoning_score: 78.2,
    coding_score: 81.0,
    math_score: 74.0,
    language_score: 81.0,
    if_score: 86.5,
    data_analysis_score: 71.5,
    context_window: 1000000,
    is_outdated: false,
  },
  'gemini-3.6-flash': {
    name: 'Google Gemini 3.6 Flash',
    provider_hint: 'google',
    overall_score: 74.2,
    reasoning_score: 76.0,
    coding_score: 78.5,
    math_score: 71.5,
    language_score: 79.5,
    if_score: 84.5,
    data_analysis_score: 69.5,
    context_window: 1000000,
    is_outdated: false,
  },
  'gemini-3.5-flash': {
    name: 'Google Gemini 3.5 Flash',
    provider_hint: 'google',
    overall_score: 72.4,
    reasoning_score: 74.0,
    coding_score: 76.2,
    math_score: 69.5,
    language_score: 78.0,
    if_score: 83.5,
    data_analysis_score: 68.0,
    context_window: 1000000,
    is_outdated: false,
  },
  'gemini-3.1-flash-lite': {
    name: 'Google Gemini 3.1 Flash-Lite',
    provider_hint: 'google',
    overall_score: 68.5,
    reasoning_score: 69.5,
    coding_score: 71.0,
    math_score: 65.0,
    language_score: 74.0,
    if_score: 80.0,
    data_analysis_score: 64.0,
    context_window: 1000000,
    is_outdated: false,
  },
  'gemini-3-flash': {
    name: 'Google Gemini 3 Flash Preview',
    provider_hint: 'google',
    overall_score: 69.0,
    reasoning_score: 70.0,
    coding_score: 72.0,
    math_score: 66.0,
    language_score: 75.0,
    if_score: 81.0,
    data_analysis_score: 65.0,
    context_window: 1000000,
    is_outdated: false,
  },

  // Other Frontier / Active Models
  'deepseek-v4-pro': {
    name: 'DeepSeek V4 Pro 0813',
    provider_hint: 'deepseek',
    overall_score: 77.4,
    reasoning_score: 80.5,
    coding_score: 82.0,
    math_score: 78.2,
    language_score: 79.5,
    if_score: 81.0,
    data_analysis_score: 71.5,
    context_window: 128000,
    is_outdated: false,
  },
  'nemotron-3-ultra': {
    name: 'NVIDIA Nemotron 3 Ultra 550B',
    provider_hint: 'nvidia',
    overall_score: 74.6,
    reasoning_score: 76.8,
    coding_score: 78.2,
    math_score: 73.0,
    language_score: 77.5,
    if_score: 82.0,
    data_analysis_score: 69.0,
    context_window: 131072,
    is_outdated: false,
  },
  'nemotron-3.5-lightning': {
    name: 'NVIDIA Nemotron 3.5 Lightning',
    provider_hint: 'nvidia',
    overall_score: 68.2,
    reasoning_score: 69.0,
    coding_score: 72.5,
    math_score: 64.0,
    language_score: 73.0,
    if_score: 79.0,
    data_analysis_score: 63.5,
    context_window: 1000000,
    is_outdated: false,
  },
  'glm-5-2': {
    name: 'Zhipu GLM 5.2',
    provider_hint: 'z-ai',
    overall_score: 71.5,
    reasoning_score: 73.2,
    coding_score: 74.0,
    math_score: 68.0,
    language_score: 75.0,
    if_score: 78.5,
    data_analysis_score: 67.0,
    context_window: 128000,
    is_outdated: false,
  },
  'laguna-s2-1': {
    name: 'Poolside Laguna S 2.1',
    provider_hint: 'poolside',
    overall_score: 69.8,
    reasoning_score: 71.0,
    coding_score: 75.8,
    math_score: 66.2,
    language_score: 72.0,
    if_score: 76.0,
    data_analysis_score: 65.0,
    context_window: 128000,
    is_outdated: false,
  },
  'groq-gpt-120b': {
    name: 'GPT-OSS 120B on Groq LPU',
    provider_hint: 'groq',
    overall_score: 67.2,
    reasoning_score: 68.5,
    coding_score: 70.0,
    math_score: 63.0,
    language_score: 71.0,
    if_score: 76.5,
    data_analysis_score: 62.0,
    context_window: 131072,
    is_outdated: false,
  },
  'cerebras-gpt-120b': {
    name: 'GPT-OSS 120B on Cerebras CS-3',
    provider_hint: 'cerebras',
    overall_score: 67.2,
    reasoning_score: 68.5,
    coding_score: 70.0,
    math_score: 63.0,
    language_score: 71.0,
    if_score: 76.5,
    data_analysis_score: 62.0,
    context_window: 131072,
    is_outdated: false,
  },
  'cerebras-gemma4-31b': {
    name: 'Gemma 4 31B on Cerebras CS-3',
    provider_hint: 'cerebras',
    overall_score: 63.5,
    reasoning_score: 64.0,
    coding_score: 66.5,
    math_score: 59.0,
    language_score: 68.0,
    if_score: 72.0,
    data_analysis_score: 58.5,
    context_window: 131072,
    is_outdated: false,
  },
  'groq-qwen-27b': {
    name: 'Qwen 3.6 27B on Groq LPU',
    provider_hint: 'groq',
    overall_score: 61.0,
    reasoning_score: 62.5,
    coding_score: 63.0,
    math_score: 57.0,
    language_score: 65.0,
    if_score: 70.0,
    data_analysis_score: 55.0,
    context_window: 131072,
    is_outdated: false,
  },
  'groq-gpt-20b': {
    name: 'GPT-OSS 20B on Groq LPU',
    provider_hint: 'groq',
    overall_score: 54.8,
    reasoning_score: 55.0,
    coding_score: 57.0,
    math_score: 50.0,
    language_score: 60.0,
    if_score: 64.0,
    data_analysis_score: 48.0,
    context_window: 131072,
    is_outdated: false,
  },

  // Outdated / Legacy Section
  'gemini-3.1-pro': {
    name: 'Google Gemini 3.1 Pro (Legacy)',
    provider_hint: 'google',
    overall_score: 72.1,
    reasoning_score: 73.5,
    coding_score: 75.0,
    math_score: 70.0,
    language_score: 76.0,
    if_score: 80.0,
    data_analysis_score: 68.0,
    context_window: 2000000,
    is_outdated: true,
  },
  'mistral-nemotron': {
    name: 'Mistral Nemotron (Legacy)',
    provider_hint: 'mistralai',
    overall_score: 58.4,
    reasoning_score: 59.0,
    coding_score: 61.0,
    math_score: 53.0,
    language_score: 62.0,
    if_score: 66.0,
    data_analysis_score: 52.0,
    context_window: 128000,
    is_outdated: true,
  },
  'nemotron-super-49b': {
    name: 'NVIDIA Nemotron Super 49B (Legacy)',
    provider_hint: 'nvidia',
    overall_score: 60.2,
    reasoning_score: 61.0,
    coding_score: 63.0,
    math_score: 56.0,
    language_score: 64.0,
    if_score: 68.0,
    data_analysis_score: 54.0,
    context_window: 131072,
    is_outdated: true,
  },
  'gemma-4-26b': {
    name: 'Google Gemma 4 26B (Legacy)',
    provider_hint: 'google',
    overall_score: 56.8,
    reasoning_score: 57.0,
    coding_score: 59.0,
    math_score: 52.0,
    language_score: 61.0,
    if_score: 65.0,
    data_analysis_score: 50.0,
    context_window: 262144,
    is_outdated: true,
  },
  'dots-3-note': {
    name: 'Dots 3 Note Preview (Legacy)',
    provider_hint: 'dots-studio',
    overall_score: 49.0,
    reasoning_score: 48.0,
    coding_score: 51.0,
    math_score: 44.0,
    language_score: 54.0,
    if_score: 58.0,
    data_analysis_score: 43.0,
    context_window: 128000,
    is_outdated: true,
  },
};

/**
 * Fuzzy match a model id / hint / model_string against LiveBench registry
 */
export function fuzzyMatchLiveBench(queryStr: string, hint?: string): LiveBenchMatchResult {
  const target = (hint || queryStr).toLowerCase().replace(/[^a-z0-9]/g, '');
  
  let bestKey: string | null = null;
  let bestScore = 0;

  for (const [key, entry] of Object.entries(LIVEBENCH_REGISTRY)) {
    const keyClean = key.toLowerCase().replace(/[^a-z0-9]/g, '');
    const nameClean = entry.name.toLowerCase().replace(/[^a-z0-9]/g, '');

    // 1. Direct exact match
    if (keyClean === target || nameClean === target) {
      return {
        matched: true,
        score: 1.0,
        matched_name: entry.name,
        metrics: entry,
        status: 'success',
      };
    }

    if (target.includes(keyClean) || keyClean.includes(target) || nameClean.includes(target) || target.includes(nameClean)) {
      const matchLength = Math.min(target.length, keyClean.length);
      const score = matchLength / Math.max(target.length, keyClean.length);
      if (score > bestScore) {
        bestScore = score;
        bestKey = key;
      }
    }

    // 2. Token overlap similarity
    const targetTokens = new Set((hint || queryStr).toLowerCase().split(/[\s\-_/:]+/));
    const entryTokens = new Set(entry.name.toLowerCase().split(/[\s\-_/:]+/));
    
    let intersection = 0;
    for (const t of targetTokens) {
      if (entryTokens.has(t)) intersection++;
    }

    const tokenScore = (2 * intersection) / (targetTokens.size + entryTokens.size);
    if (tokenScore > bestScore && tokenScore > 0.35) {
      bestScore = tokenScore;
      bestKey = key;
    }
  }

  if (bestKey && bestScore >= 0.38) {
    const entry = LIVEBENCH_REGISTRY[bestKey];
    return {
      matched: true,
      score: bestScore,
      matched_name: entry.name,
      metrics: entry,
      status: 'success',
    };
  }

  return {
    matched: false,
    score: bestScore,
    status: 'fail',
  };
}
