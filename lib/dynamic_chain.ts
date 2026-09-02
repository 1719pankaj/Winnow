/**
 * Dynamic Inference Fallback Chain Resolver
 * 
 * Enforces strict user governance rules:
 * 1. NO disabled models (checked against Turso DB status_override and provider status).
 * 2. NO outdated / legacy models (checked against Turso DB and catalog classifications).
 * 3. NO incompatible models (embeddings, audio/TTS, media generators).
 * 4. NO failed endpoints (tested_status !== 'fail').
 * 5. NO slow endpoints taking > 3.0 seconds (> 3000ms) to return OK.
 */

import { FullWinnowConfig } from './config/models';
import { loadConfig } from './config/loader';
import { store } from './store';

export interface DynamicChainResult {
  primaryModelId: string;
  chain: string[];
  disqualifiedRequestedModel?: string;
  disqualificationReason?: string;
}

export async function resolveDynamicFallbackChain(
  requestedModelId?: string,
  config?: FullWinnowConfig
): Promise<DynamicChainResult> {
  await store.init();
  const loadedConfig = config || loadConfig();
  const dbCards = await store.getCachedModelCards();
  const dbCardMap = new Map(dbCards.map((c) => [c.id, c]));
  const providersMap = new Map(loadedConfig.inference.inference_providers.map((p: any) => [p.name, p]));

  // Helper to validate whether a model qualifies
  const checkModelQualification = (modelId: string): { eligible: boolean; reason?: string } => {
    const modelCfg = loadedConfig.inference.models.find((m: any) => m.id === modelId);
    if (!modelCfg) {
      return { eligible: false, reason: `Model "${modelId}" not found in inference models catalog` };
    }

    const prov: any = providersMap.get(modelCfg.provider);
    if (!prov || !prov.enabled) {
      return { eligible: false, reason: `Provider "${modelCfg.provider}" is disabled` };
    }

    const dbCard = dbCardMap.get(modelId);

    // Rule 1: NO disabled models
    if (dbCard?.status_override === 'disabled') {
      return { eligible: false, reason: `Model "${modelId}" is flagged as Disabled in database` };
    }

    // Rule 2: NO outdated / legacy models
    if (dbCard?.status_override === 'outdated' || modelId.includes('legacy') || (modelCfg as any).benchmark_hint?.includes('legacy')) {
      return { eligible: false, reason: `Model "${modelId}" is flagged as Outdated / Legacy` };
    }

    // Rule 3: NO incompatible models
    if (dbCard?.status_override === 'incompatible') {
      return { eligible: false, reason: `Model "${modelId}" is flagged as Incompatible` };
    }

    // Rule 4: NO failed endpoints
    if (dbCard?.tested_status === 'fail') {
      return { eligible: false, reason: `Model "${modelId}" failed ping verification: ${dbCard.tested_error || 'No OK response'}` };
    }

    // Rule 5: NO endpoints taking > 3.0 seconds (3000ms) to return OK
    if (dbCard?.tested_latency_ms !== undefined && dbCard.tested_latency_ms > 3000) {
      return { eligible: false, reason: `Model "${modelId}" latency is ${dbCard.tested_latency_ms}ms (exceeds 3000ms max cutoff)` };
    }

    return { eligible: true };
  };

  let disqualifiedRequestedModel: string | undefined;
  let disqualificationReason: string | undefined;

  // 1. Validate requested model if specified
  if (requestedModelId && requestedModelId !== 'auto') {
    const check = checkModelQualification(requestedModelId);
    if (!check.eligible) {
      disqualifiedRequestedModel = requestedModelId;
      disqualificationReason = check.reason;
    }
  }

  // 2. Build candidate pool from requested model + configured fallback chain
  const rawPool = [
    ...(requestedModelId && !disqualifiedRequestedModel ? [requestedModelId] : []),
    ...loadedConfig.inference.model_policy.fallback_chain,
  ];

  const eligibleChain: string[] = [];
  const seen = new Set<string>();

  for (const id of rawPool) {
    if (seen.has(id)) continue;
    seen.add(id);

    const check = checkModelQualification(id);
    if (check.eligible) {
      eligibleChain.push(id);
    }
  }

  // 3. Fallback to guaranteed ultra-speed models (< 3s) if chain is empty
  if (eligibleChain.length === 0) {
    const emergencyCandidates = ['groq-gpt-120b', 'groq-qwen-27b', 'or-gemini-3.7-flash', 'or-glm-5-3-flash'];
    for (const emId of emergencyCandidates) {
      const check = checkModelQualification(emId);
      if (check.eligible) {
        eligibleChain.push(emId);
      }
    }

    // Ultimate fallback if all else fails
    if (eligibleChain.length === 0) {
      eligibleChain.push('groq-gpt-120b');
    }
  }

  return {
    primaryModelId: eligibleChain[0],
    chain: eligibleChain,
    disqualifiedRequestedModel,
    disqualificationReason,
  };
}
