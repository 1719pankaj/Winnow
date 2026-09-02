import { fetchOpenRouterModels, OpenRouterModelCard, matchOpenRouterModel } from './benchmarks';
import { fetchNimModels, fetchGroqModels, fetchGoogleGeminiModels, GoogleGeminiApiModel, OpenAiCompatibleModel } from './provider_catalog';
import { loadConfig } from './config/loader';
import { store } from './store';
import { classifyModelCategory } from '../app/api/admin/models/route';

export interface CatalogModelItem {
  id: string;
  provider: string;
  model_string: string;
  name: string;
  category: 'active' | 'outdated' | 'incompatible' | 'disabled';
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
 * Synchronize live provider models from NVIDIA NIM, Groq, Google Gemini, and OpenRouter
 */
export async function syncLiveModelCatalog(): Promise<CatalogModelItem[]> {
  await store.init();
  const config = loadConfig();
  const providers = config.inference.inference_providers;
  const provMap = new Map(providers.map((p) => [p.name, p]));

  const geminiProvider = provMap.get('gemini');
  const nimProvider = provMap.get('nim');
  const groqProvider = provMap.get('groq');

  // 1. Fetch live models across all providers concurrently
  const [orModels, googleModels, nimModels, groqModels] = await Promise.all([
    fetchOpenRouterModels(),
    fetchGoogleGeminiModels(geminiProvider?.api_key),
    fetchNimModels(nimProvider?.api_key),
    fetchGroqModels(groqProvider?.api_key),
  ]);

  const cachedDbCards = await store.getCachedModelCards();
  const dbCardMap = new Map(cachedDbCards.map((c) => [c.id, c]));

  const catalog: CatalogModelItem[] = [];
  const seenIds = new Set<string>();

  // A. Configured models in inference.yaml
  for (const m of config.inference.models) {
    seenIds.add(m.id);
    seenIds.add(m.model_string);
    const p = provMap.get(m.provider);
    const isEnabled = p?.enabled ?? false;
    const dbCard = dbCardMap.get(m.id);

    const match = matchOpenRouterModel(m.id, m.model_string, (m as any).benchmark_hint || m.id, orModels);
    const orCard = match.matched_model;
    const aa = orCard?.benchmarks?.artificial_analysis;

    const isFree = m.cost === 'free' || m.model_string.endsWith(':free') || (orCard?.pricing?.prompt === '0' && orCard?.pricing?.completion === '0');
    const classification = classifyModelCategory(m, dbCard?.status_override, isEnabled);

    catalog.push({
      id: m.id,
      provider: m.provider,
      model_string: m.model_string,
      name: (m as any).benchmark_hint || orCard?.name || m.id,
      category: classification.category,
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

  // B. Auto-discover all live NVIDIA NIM models (80+ models)
  for (const nm of nimModels) {
    const rawModelString = nm.id;
    const customId = `nim-live-${rawModelString.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

    if (seenIds.has(customId) || seenIds.has(rawModelString)) continue;
    seenIds.add(customId);
    seenIds.add(rawModelString);

    const dbCard = dbCardMap.get(customId);
    const match = matchOpenRouterModel(customId, rawModelString, rawModelString, orModels);
    const orCard = match.matched_model;
    const aa = orCard?.benchmarks?.artificial_analysis;
    const classification = classifyModelCategory(
      { id: customId, provider: 'nim', model_string: rawModelString },
      dbCard?.status_override,
      nimProvider?.enabled ?? false
    );

    catalog.push({
      id: customId,
      provider: 'nim',
      model_string: rawModelString,
      name: `NVIDIA NIM: ${rawModelString}`,
      category: classification.category,
      is_free: false,
      pricing: orCard?.pricing ? { prompt: orCard.pricing.prompt, completion: orCard.pricing.completion } : undefined,
      context_length: orCard?.context_length || 131072,
      intelligence_index: aa?.intelligence_index ?? dbCard?.intelligence_index,
      coding_index: aa?.coding_index ?? dbCard?.coding_index,
      agentic_index: aa?.agentic_index ?? dbCard?.agentic_index,
      tested_latency_ms: dbCard?.tested_latency_ms,
      tested_status: !nimProvider?.enabled ? 'disabled' : (dbCard?.tested_status as any) || 'untested',
    });
  }

  // C. Auto-discover all live Groq models (14+ models)
  for (const gm of groqModels) {
    const rawModelString = gm.id;
    const customId = `groq-live-${rawModelString.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

    if (seenIds.has(customId) || seenIds.has(rawModelString)) continue;
    seenIds.add(customId);
    seenIds.add(rawModelString);

    const dbCard = dbCardMap.get(customId);
    const match = matchOpenRouterModel(customId, rawModelString, rawModelString, orModels);
    const orCard = match.matched_model;
    const aa = orCard?.benchmarks?.artificial_analysis;
    const classification = classifyModelCategory(
      { id: customId, provider: 'groq', model_string: rawModelString },
      dbCard?.status_override,
      groqProvider?.enabled ?? false
    );

    catalog.push({
      id: customId,
      provider: 'groq',
      model_string: rawModelString,
      name: `Groq: ${rawModelString}`,
      category: classification.category,
      is_free: false,
      pricing: orCard?.pricing ? { prompt: orCard.pricing.prompt, completion: orCard.pricing.completion } : undefined,
      context_length: gm.context_window || orCard?.context_length || 131072,
      intelligence_index: aa?.intelligence_index ?? dbCard?.intelligence_index,
      coding_index: aa?.coding_index ?? dbCard?.coding_index,
      agentic_index: aa?.agentic_index ?? dbCard?.agentic_index,
      tested_latency_ms: dbCard?.tested_latency_ms,
      tested_status: !groqProvider?.enabled ? 'disabled' : (dbCard?.tested_status as any) || 'untested',
    });
  }

  // D. Auto-discover all live Google Gemini models (40+ models)
  for (const gm of googleModels) {
    const rawModelString = gm.name.replace(/^models\//, '');
    const customId = `gemini-live-${rawModelString.replace(/[^a-zA-Z0-9_-]/g, '-')}`;

    if (seenIds.has(customId) || seenIds.has(rawModelString)) continue;
    seenIds.add(customId);
    seenIds.add(rawModelString);

    const match = matchOpenRouterModel(customId, rawModelString, gm.displayName, orModels);
    const orCard = match.matched_model;
    const aa = orCard?.benchmarks?.artificial_analysis;
    const dbCard = dbCardMap.get(customId);
    const classification = classifyModelCategory(
      { id: customId, provider: 'gemini', model_string: rawModelString, benchmark_hint: gm.displayName },
      dbCard?.status_override,
      geminiProvider?.enabled ?? false
    );

    catalog.push({
      id: customId,
      provider: 'gemini',
      model_string: rawModelString,
      name: gm.displayName || `Google: ${rawModelString}`,
      category: classification.category,
      is_free: false,
      pricing: orCard?.pricing ? { prompt: orCard.pricing.prompt, completion: orCard.pricing.completion } : undefined,
      context_length: gm.inputTokenLimit || 1000000,
      intelligence_index: aa?.intelligence_index ?? dbCard?.intelligence_index,
      coding_index: aa?.coding_index ?? dbCard?.coding_index,
      agentic_index: aa?.agentic_index ?? dbCard?.agentic_index,
      tested_latency_ms: dbCard?.tested_latency_ms,
      tested_status: !geminiProvider?.enabled ? 'disabled' : (dbCard?.tested_status as any) || 'untested',
    });
  }

  // E. Auto-discover all active FREE models from OpenRouter
  const freeORModels = orModels.filter((m) => 
    m.id.endsWith(':free') || 
    (m.pricing && m.pricing.prompt === '0' && m.pricing.completion === '0')
  );

  for (const m of freeORModels) {
    const customId = `or-free-${m.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    if (seenIds.has(customId) || seenIds.has(m.id)) continue;
    seenIds.add(customId);
    seenIds.add(m.id);

    const aa = m.benchmarks?.artificial_analysis;
    const dbCard = dbCardMap.get(customId);

    catalog.push({
      id: customId,
      provider: 'openrouter',
      model_string: m.id,
      name: `${m.name} (Free Tier)`,
      category: 'active',
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
