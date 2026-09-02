import { NextRequest, NextResponse } from 'next/server';
import { loadConfig } from '@/lib/config/loader';
import { fetchOpenRouterModels, matchOpenRouterModel } from '@/lib/benchmarks';
import { InferenceAdapter } from '@/lib/adapters/inference';
import { store, CachedModelCard } from '@/lib/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export interface ModelBenchmarkItem {
  id: string;
  provider: string;
  model_string: string;
  benchmark_hint?: string;
  role: string[];
  capabilities: any;
  tested_latency_ms?: number;
  tested_status: 'ok' | 'fail' | 'disabled' | 'untested';
  tested_error?: string;
  openrouter_match: {
    status: 'success' | 'fail';
    matched_id?: string;
    matched_name?: string;
    score: number;
    intelligence_index?: number;
    coding_index?: number;
    agentic_index?: number;
    context_length?: number;
    pricing?: {
      prompt: string;
      completion: string;
      input_cache_read?: string;
    };
  };
}

export async function GET(req: NextRequest) {
  try {
    await store.init();
    const config = loadConfig();
    const models = config.inference.models;
    const providers = config.inference.inference_providers;
    const provMap = new Map(providers.map((p) => [p.name, p]));

    // Fetch live ratings from OpenRouter API
    const orModels = await fetchOpenRouterModels();

    // Read cached benchmarks from Turso DB
    const cachedDbCards = await store.getCachedModelCards();
    const dbCardMap = new Map(cachedDbCards.map((c) => [c.id, c]));

    const items: ModelBenchmarkItem[] = [];

    for (const m of models) {
      const p = provMap.get(m.provider);
      const isEnabled = p?.enabled ?? false;
      const dbCard = dbCardMap.get(m.id);

      // Match against OpenRouter models
      const match = matchOpenRouterModel(m.id, m.model_string, (m as any).benchmark_hint || (m as any).livebench_hint || m.id, orModels);
      const aa = match.matched_model?.benchmarks?.artificial_analysis;

      const item: ModelBenchmarkItem = {
        id: m.id,
        provider: m.provider,
        model_string: m.model_string,
        benchmark_hint: (m as any).benchmark_hint || (m as any).livebench_hint,
        role: m.role,
        capabilities: m.capabilities,
        tested_latency_ms: dbCard?.tested_latency_ms,
        tested_status: !isEnabled ? 'disabled' : (dbCard?.tested_status as any) || 'untested',
        tested_error: dbCard?.tested_error,
        openrouter_match: {
          status: match.status,
          matched_id: match.matched_model?.id,
          matched_name: match.matched_model?.name,
          score: match.score,
          intelligence_index: aa?.intelligence_index ?? dbCard?.intelligence_index,
          coding_index: aa?.coding_index ?? dbCard?.coding_index,
          agentic_index: aa?.agentic_index ?? dbCard?.agentic_index,
          context_length: match.matched_model?.context_length ?? dbCard?.context_length,
          pricing: match.matched_model?.pricing,
        },
      };

      items.push(item);
    }

    return NextResponse.json({
      models: items,
      providers: providers.map((p) => ({ name: p.name, enabled: p.enabled })),
      total: items.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[API /api/admin/models Error]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await store.init();
    const config = loadConfig();
    const body = await req.json().catch(() => ({}));
    const targetModelId = typeof body.model_id === 'string' ? body.model_id : null;

    const models = config.inference.models.filter((m) => !targetModelId || m.id === targetModelId);
    const providers = config.inference.inference_providers;
    const provMap = new Map(providers.map((p) => [p.name, p]));

    const orModels = await fetchOpenRouterModels();
    const benchmarkResults: ModelBenchmarkItem[] = [];

    for (const m of models) {
      const p = provMap.get(m.provider);
      const match = matchOpenRouterModel(m.id, m.model_string, (m as any).benchmark_hint || (m as any).livebench_hint || m.id, orModels);
      const aa = match.matched_model?.benchmarks?.artificial_analysis;

      if (!p || !p.enabled) {
        const item: ModelBenchmarkItem = {
          id: m.id,
          provider: m.provider,
          model_string: m.model_string,
          benchmark_hint: (m as any).benchmark_hint || (m as any).livebench_hint,
          role: m.role,
          capabilities: m.capabilities,
          tested_status: 'disabled',
          openrouter_match: {
            status: match.status,
            matched_id: match.matched_model?.id,
            matched_name: match.matched_model?.name,
            score: match.score,
            intelligence_index: aa?.intelligence_index,
            coding_index: aa?.coding_index,
            agentic_index: aa?.agentic_index,
            context_length: match.matched_model?.context_length,
            pricing: match.matched_model?.pricing,
          },
        };
        benchmarkResults.push(item);
        continue;
      }

      const adapter = new InferenceAdapter(p, m);
      const t0 = Date.now();

      try {
        const timeoutPromise = new Promise<string>((_, reject) =>
          setTimeout(() => reject(new Error('Benchmark timed out after 12000ms')), 12000)
        );

        const callPromise = adapter.complete(
          [{ role: 'user', content: 'Say "OK"' }],
          { maxTokens: 10, temperature: 0.1 }
        );

        await Promise.race([callPromise, timeoutPromise]);
        const elapsed = Date.now() - t0;

        const item: ModelBenchmarkItem = {
          id: m.id,
          provider: m.provider,
          model_string: m.model_string,
          benchmark_hint: (m as any).benchmark_hint || (m as any).livebench_hint,
          role: m.role,
          capabilities: m.capabilities,
          tested_latency_ms: elapsed,
          tested_status: 'ok',
          openrouter_match: {
            status: match.status,
            matched_id: match.matched_model?.id,
            matched_name: match.matched_model?.name,
            score: match.score,
            intelligence_index: aa?.intelligence_index,
            coding_index: aa?.coding_index,
            agentic_index: aa?.agentic_index,
            context_length: match.matched_model?.context_length,
            pricing: match.matched_model?.pricing,
          },
        };

        // Cache in Turso DB
        await store.saveCachedModelCard({
          id: m.id,
          provider: m.provider,
          model_string: m.model_string,
          intelligence_index: aa?.intelligence_index,
          coding_index: aa?.coding_index,
          agentic_index: aa?.agentic_index,
          openrouter_id: match.matched_model?.id,
          context_length: match.matched_model?.context_length,
          match_status: match.status,
          tested_latency_ms: elapsed,
          tested_status: 'ok',
          capabilities_json: JSON.stringify(m.capabilities),
          updated_at: new Date().toISOString(),
        });

        benchmarkResults.push(item);
      } catch (err: any) {
        const elapsed = Date.now() - t0;
        const item: ModelBenchmarkItem = {
          id: m.id,
          provider: m.provider,
          model_string: m.model_string,
          benchmark_hint: (m as any).benchmark_hint || (m as any).livebench_hint,
          role: m.role,
          capabilities: m.capabilities,
          tested_latency_ms: elapsed,
          tested_status: 'fail',
          tested_error: err.message,
          openrouter_match: {
            status: match.status,
            matched_id: match.matched_model?.id,
            matched_name: match.matched_model?.name,
            score: match.score,
            intelligence_index: aa?.intelligence_index,
            coding_index: aa?.coding_index,
            agentic_index: aa?.agentic_index,
            context_length: match.matched_model?.context_length,
            pricing: match.matched_model?.pricing,
          },
        };

        // Cache failure in Turso DB
        await store.saveCachedModelCard({
          id: m.id,
          provider: m.provider,
          model_string: m.model_string,
          intelligence_index: aa?.intelligence_index,
          coding_index: aa?.coding_index,
          agentic_index: aa?.agentic_index,
          openrouter_id: match.matched_model?.id,
          context_length: match.matched_model?.context_length,
          match_status: match.status,
          tested_latency_ms: elapsed,
          tested_status: 'fail',
          tested_error: err.message,
          capabilities_json: JSON.stringify(m.capabilities),
          updated_at: new Date().toISOString(),
        });

        benchmarkResults.push(item);
      }
    }

    return NextResponse.json({
      results: benchmarkResults,
      count: benchmarkResults.length,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[API /api/admin/models Benchmark Error]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
