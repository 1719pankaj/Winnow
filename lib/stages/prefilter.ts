import OpenAI from 'openai';
import { Candidate } from '../types';
import { FullWinnowConfig } from '../config/models';

export interface PrefilterOptions {
  query: string;
  intent: string | null;
  candidates: Candidate[];
  config: FullWinnowConfig;
  tierName: 'rush' | 'fast' | 'right';
  advisoryAvoidDomains?: string[];
}

export interface PrefilterOutput {
  candidates: Candidate[];
  keptCount: number;
  droppedCount: number;
  droppedByBlocklist: number;
  is_degraded?: boolean;
}

function matchPattern(domain: string, pattern: string): boolean {
  const cleanDomain = domain.toLowerCase();
  const cleanPattern = pattern.toLowerCase().trim();

  if (cleanPattern.startsWith('*.')) {
    const base = cleanPattern.slice(2);
    return cleanDomain === base || cleanDomain.endsWith('.' + base);
  }
  if (cleanPattern.endsWith('.*')) {
    const base = cleanPattern.slice(0, -2);
    return cleanDomain.startsWith(base);
  }
  if (cleanPattern.includes('*')) {
    const regex = new RegExp('^' + cleanPattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
    return regex.test(cleanDomain);
  }
  return cleanDomain === cleanPattern || cleanDomain.endsWith('.' + cleanPattern);
}

function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length || vecA.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return Math.max(0, Math.min(1, dot / (Math.sqrt(normA) * Math.sqrt(normB))));
}

// Simple token-based embedding fallback if external embedding API is unavailable
function fallbackTokenEmbedding(text: string, dims = 128): number[] {
  const vec = new Float32Array(dims);
  const words = text.toLowerCase().match(/\b\w+\b/g) || [];
  for (const w of words) {
    let hash = 0;
    for (let i = 0; i < w.length; i++) {
      hash = (hash << 5) - hash + w.charCodeAt(i);
      hash |= 0;
    }
    const idx = Math.abs(hash) % dims;
    vec[idx] += 1;
  }
  // Normalize
  let norm = 0;
  for (let i = 0; i < dims; i++) norm += vec[i] * vec[i];
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < dims; i++) vec[i] /= norm;
  }
  return Array.from(vec);
}

export async function stagePrefilter(options: PrefilterOptions): Promise<PrefilterOutput> {
  const { query, intent, candidates, config, tierName, advisoryAvoidDomains = [] } = options;
  const tierConfig = config.winnow.tiers[tierName];
  const { hard, soft, soft_penalty } = config.winnow.blocklist;
  const { weight_embedding, weight_fused } = config.winnow.prefilter;

  let droppedByBlocklist = 0;

  // 1. Separate candidates already dropped in Stage 1
  const activeCandidates: Candidate[] = [];
  const droppedCandidates: Candidate[] = [];

  for (const c of candidates) {
    if (c.dropped_at_stage) {
      droppedCandidates.push(c);
      continue;
    }

    // Check Hard Blocklist (Section 6.3)
    const isHardBlocked = hard.some((pat) => matchPattern(c.domain, pat));
    if (isHardBlocked) {
      c.dropped_at_stage = 'prefilter';
      c.drop_reason = 'blocklist_hard';
      droppedByBlocklist++;
      droppedCandidates.push(c);
      continue;
    }

    // Check Soft Blocklist & Planner Advisory Avoid Domains
    const isSoftBlocked = soft.some((pat) => matchPattern(c.domain, pat));
    const isAdvisoryAvoid = advisoryAvoidDomains.some((d) => matchPattern(c.domain, d));
    if (isSoftBlocked || isAdvisoryAvoid) {
      c.blocklist_penalty = soft_penalty;
    }

    activeCandidates.push(c);
  }

  if (activeCandidates.length === 0) {
    return {
      candidates: [...droppedCandidates],
      keptCount: 0,
      droppedCount: droppedCandidates.length,
      droppedByBlocklist,
    };
  }

  // 2. Build Embedding Texts
  const queryEmbedText = intent ? `${query}\n${intent.slice(0, 500)}` : query;
  const candidateTexts = activeCandidates.map((c) => `${c.title}\n${c.snippet}`.slice(0, 1000));

  let queryVector: number[] | null = null;
  let candidateVectors: number[][] = [];

  // Attempt embeddings via OpenRouter or fallback
  try {
    const openrouterKey = process.env.OPEN_ROUTER_API_KEY;
    if (openrouterKey) {
      const client = new OpenAI({
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: openrouterKey,
      });

      const embedRes = await client.embeddings.create({
        model: 'liquid/lfm-2.5-embedding-350m:free',
        input: [queryEmbedText, ...candidateTexts],
      });

      if (embedRes.data && embedRes.data.length === candidateTexts.length + 1) {
        queryVector = embedRes.data[0].embedding;
        candidateVectors = embedRes.data.slice(1).map((d) => d.embedding);
      }
    }
  } catch (err) {
    console.warn('[Prefilter Stage] Remote embedding API unavailable, using fast local similarity.');
  }

  // Fallback if remote embeddings did not execute
  if (!queryVector || candidateVectors.length !== activeCandidates.length) {
    queryVector = fallbackTokenEmbedding(queryEmbedText);
    candidateVectors = candidateTexts.map((t) => fallbackTokenEmbedding(t));
  }

  // 3. Compute Cosine Similarity & Normalize Fused Scores
  const maxFused = Math.max(...activeCandidates.map((c) => c.fused_score), 0.0001);

  activeCandidates.forEach((c, idx) => {
    const sim = cosineSimilarity(queryVector!, candidateVectors[idx]);
    c.prefilter_score = sim;
  });

  // Sort active candidates by combined prefilter score
  activeCandidates.sort((a, b) => {
    const scoreA = weight_embedding * (a.prefilter_score || 0) + weight_fused * (a.fused_score / maxFused);
    const scoreB = weight_embedding * (b.prefilter_score || 0) + weight_fused * (b.fused_score / maxFused);
    return scoreB - scoreA;
  });

  // 4. Fused Score Guard (Section 6.3): Single highest fused_score candidate is always protected
  let highestFusedCandidate = activeCandidates[0];
  for (const c of activeCandidates) {
    if (c.fused_score > highestFusedCandidate.fused_score) {
      highestFusedCandidate = c;
    }
  }

  const keepLimit = tierConfig.prefilter_keep;
  const kept: Candidate[] = [];
  const newlyDropped: Candidate[] = [];

  for (let i = 0; i < activeCandidates.length; i++) {
    const c = activeCandidates[i];
    if (i < keepLimit || c.id === highestFusedCandidate.id) {
      kept.push(c);
    } else {
      c.dropped_at_stage = 'prefilter';
      c.drop_reason = 'low_relevance';
      newlyDropped.push(c);
    }
  }

  return {
    candidates: [...kept, ...newlyDropped, ...droppedCandidates],
    keptCount: kept.length,
    droppedCount: newlyDropped.length + droppedCandidates.length,
    droppedByBlocklist,
  };
}
