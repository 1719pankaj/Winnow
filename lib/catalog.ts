import { fetchOpenRouterModels, OpenRouterModelCard, matchOpenRouterModel } from './benchmarks';
import { loadConfig } from './config/loader';
import { store } from './store';

export interface CatalogModelItem {
  id: string;
  provider: string;
  model_string: string;
  name: string;
  category: 'free' | 'frontier' | 'speed' | 'legacy';
  is_free: boolean;
  pricing?: {
    prompt: string;
    completion: string;
  };
  context_length: number;
  intelligence_index?: number;
  coding_index?: number;
  agentic_index?: number;
  tested_latency_ms?: number;
  tested_status: 'ok' | 'fail' | 'disabled' | 'untested';
}

/**
 * Synchronize live provider models from OpenRouter, Cerebras, Groq, Gemini, and NIM
 */
export async function syncLiveModelCatalog(): Promise<CatalogModelItem[]> {
  await store.init();
  const config = loadConfig();
  const providers = config.inference.inference_providers;
  const provMap = new Map(providers.map((p) => [p.name, p]));

  // 1. Fetch live OpenRouter models catalog (420+ models)
  const orModels = await fetchOpenRouterModels();
  const cachedDbCards = await store.getCachedModelCards();
  const dbCardMap = new Map(cachedDbCards.map((c) => [c.id, c]));

  const catalog: CatalogModelItem[] = [];
  const seenIds = new Set<string>();

  // A. Configured models in inference.yaml
  for (const m of config.inference.models) {
    seenIds.add(m.id);
    const p = provMap.get(m.provider);
    const isEnabled = p?.enabled ?? false;
    const dbCard = dbCardMap.get(m.id);

    const match = matchOpenRouterModel(m.id, m.model_string, (m as any).benchmark_hint || m.id, orModels);
    const orCard = match.matched_model;
    const aa = orCard?.benchmarks?.artificial_analysis;

    const isFree = m.cost === 'free' || m.model_string.endsWith(':free') || (orCard?.pricing?.prompt === '0' && orCard?.pricing?.completion === '0');
    const isLegacy = m.id.includes('legacy') || (m as any).benchmark_hint?.includes('legacy');
    const isSpeed = m.provider === 'cerebras' || m.provider === 'groq';

    let category: 'free' | 'frontier' | 'speed' | 'legacy' = 'frontier';
    if (isLegacy) category = 'legacy';
    else if (isFree) category = 'free';
    else if (isSpeed) category = 'speed';

    catalog.push({
      id: m.id,
      provider: m.provider,
      model_string: m.model_string,
      name: (m as any).benchmark_hint || orCard?.name || m.id,
      category,
      is_free: isFree,
      pricing: orCard?.pricing ? { prompt: orCard.pricing.prompt, completion: orCard.pricing.completion } : undefined,
      context_length: orCard?.context_length || m.capabilities.max_context || 128000,
      intelligence_index: aa?.intelligence_index ?? dbCard?.intelligence_index,
      coding_index: aa?.coding_index ?? dbCard?.coding_index,
      agentic_index: aa?.agentic_index ?? dbCard?.agentic_index,
      tested_latency_ms: dbCard?.tested_latency_ms,
      tested_status: !isEnabled ? 'disabled' : (dbCard?.tested_status as any) || 'untested',
    });
  }

  // B. Auto-discover all active FREE models from OpenRouter that aren't in config yet
  const freeORModels = orModels.filter((m) => 
    m.id.endsWith(':free') || 
    (m.pricing && m.pricing.prompt === '0' && m.pricing.completion === '0')
  );

  for (const m of freeORModels) {
    const customId = `or-free-${m.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    if (seenIds.has(customId) || seenIds.has(m.id)) continue;
    seenIds.add(customId);

    const aa = m.benchmarks?.artificial_analysis;
    const dbCard = dbCardMap.get(customId);

    catalog.push({
      id: customId,
      provider: 'openrouter',
      model_string: m.id,
      name: `${m.name} (Free Tier)`,
      category: 'free',
      is_free: true,
      pricing: { prompt: '0', completion: '0' },
      context_length: m.context_length,
      intelligence_index: aa?.intelligence_index ?? dbCard?.intelligence_index,
      coding_index: aa?.coding_index ?? dbCard?.coding_index,
      agentic_index: aa?.agentic_index ?? dbCard?.agentic_index,
      tested_latency_ms: dbCard?.tested_latency_ms,
      tested_status: (dbCard?.tested_status as any) || 'untested',
    });
  }

  // Save/update sync state in Turso DB
  for (const item of catalog) {
    await store.saveCachedModelCard({
      id: item.id,
      provider: item.provider,
      model_string: item.model_string,
      intelligence_index: item.intelligence_index,
      coding_index: item.coding_index,
      agentic_index: item.agentic_index,
      openrouter_id: item.model_string,
      context_length: item.context_length,
      match_status: 'success',
      tested_latency_ms: item.tested_latency_ms,
      tested_status: item.tested_status,
      updated_at: new Date().toISOString(),
    });
  }

  return catalog;
}
