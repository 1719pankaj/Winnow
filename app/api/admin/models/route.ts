import { NextRequest, NextResponse } from 'next/server';
import { loadConfig } from '@/lib/config/loader';
import { fuzzyMatchLiveBench, LIVEBENCH_REGISTRY } from '@/lib/livebench';
import { InferenceAdapter } from '@/lib/adapters/inference';
import { store, CachedModelCard } from '@/lib/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export interface ModelBenchmarkItem {
  id: string;
  provider: string;
  model_string: string;
  livebench_hint?: string;
  role: string[];
  capabilities: any;
  tested_latency_ms?: number;
  tested_status: 'ok' | 'fail' | 'disabled' | 'untested';
  tested_error?: string;
  livebench_match: {
    status: 'success' | 'fail';
    matched_name?: string;
    score: number;
    overall_score?: number;
    reasoning_score?: number;
    coding_score?: number;
    math_score?: number;
    language_score?: number;
    if_score?: number;
    data_analysis_score?: number;
    context_window?: number;
  };
}

export async function GET(req: NextRequest) {
  try {
    await store.init();
    const config = loadConfig();
    const models = config.inference.models;
    const providers = config.inference.inference_providers;
    const provMap = new Map(providers.map((p) => [p.name, p]));

    // Read cached benchmarks from Turso DB
    const cachedDbCards = await store.getCachedModelCards();
    const dbCardMap = new Map(cachedDbCards.map((c) => [c.id, c]));

    const items: ModelBenchmarkItem[] = [];

    for (const m of models) {
      const p = provMap.get(m.provider);
      const isEnabled = p?.enabled ?? false;
      const dbCard = dbCardMap.get(m.id);

      // Fuzzy match against LiveBench
      const lbMatch = fuzzyMatchLiveBench(m.id, m.livebench_hint || m.model_string);

      const item: ModelBenchmarkItem = {
        id: m.id,
        provider: m.provider,
        model_string: m.model_string,
        livebench_hint: m.livebench_hint,
        role: m.role,
        capabilities: m.capabilities,
        tested_latency_ms: dbCard?.tested_latency_ms,
        tested_status: !isEnabled ? 'disabled' : (dbCard?.tested_status as any) || 'untested',
        tested_error: dbCard?.tested_error,
        livebench_match: {
          status: lbMatch.status,
          matched_name: lbMatch.matched_name,
          score: lbMatch.score,
          overall_score: lbMatch.metrics?.overall_score,
          reasoning_score: lbMatch.metrics?.reasoning_score,
          coding_score: lbMatch.metrics?.coding_score,
          math_score: lbMatch.metrics?.math_score,
          language_score: lbMatch.metrics?.language_score,
          if_score: lbMatch.metrics?.if_score,
          data_analysis_score: lbMatch.metrics?.data_analysis_score,
          context_window: lbMatch.metrics?.context_window,
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

    const benchmarkResults: ModelBenchmarkItem[] = [];

    for (const m of models) {
      const p = provMap.get(m.provider);
      const lbMatch = fuzzyMatchLiveBench(m.id, m.livebench_hint || m.model_string);

      if (!p || !p.enabled) {
        const item: ModelBenchmarkItem = {
          id: m.id,
          provider: m.provider,
          model_string: m.model_string,
          livebench_hint: m.livebench_hint,
          role: m.role,
          capabilities: m.capabilities,
          tested_status: 'disabled',
          livebench_match: {
            status: lbMatch.status,
            matched_name: lbMatch.matched_name,
            score: lbMatch.score,
            overall_score: lbMatch.metrics?.overall_score,
            coding_score: lbMatch.metrics?.coding_score,
            reasoning_score: lbMatch.metrics?.reasoning_score,
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
          livebench_hint: m.livebench_hint,
          role: m.role,
          capabilities: m.capabilities,
          tested_latency_ms: elapsed,
          tested_status: 'ok',
          livebench_match: {
            status: lbMatch.status,
            matched_name: lbMatch.matched_name,
            score: lbMatch.score,
            overall_score: lbMatch.metrics?.overall_score,
            reasoning_score: lbMatch.metrics?.reasoning_score,
            coding_score: lbMatch.metrics?.coding_score,
            math_score: lbMatch.metrics?.math_score,
            language_score: lbMatch.metrics?.language_score,
            if_score: lbMatch.metrics?.if_score,
            data_analysis_score: lbMatch.metrics?.data_analysis_score,
            context_window: lbMatch.metrics?.context_window,
          },
        };

        // Cache in Turso DB
        await store.saveCachedModelCard({
          id: m.id,
          provider: m.provider,
          model_string: m.model_string,
          livebench_score: lbMatch.metrics?.overall_score || 0,
          livebench_name: lbMatch.matched_name || m.id,
          match_status: lbMatch.status,
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
          livebench_hint: m.livebench_hint,
          role: m.role,
          capabilities: m.capabilities,
          tested_latency_ms: elapsed,
          tested_status: 'fail',
          tested_error: err.message,
          livebench_match: {
            status: lbMatch.status,
            matched_name: lbMatch.matched_name,
            score: lbMatch.score,
            overall_score: lbMatch.metrics?.overall_score,
            reasoning_score: lbMatch.metrics?.reasoning_score,
            coding_score: lbMatch.metrics?.coding_score,
            math_score: lbMatch.metrics?.math_score,
            language_score: lbMatch.metrics?.language_score,
            if_score: lbMatch.metrics?.if_score,
            data_analysis_score: lbMatch.metrics?.data_analysis_score,
            context_window: lbMatch.metrics?.context_window,
          },
        };

        // Cache failure in Turso DB
        await store.saveCachedModelCard({
          id: m.id,
          provider: m.provider,
          model_string: m.model_string,
          livebench_score: lbMatch.metrics?.overall_score || 0,
          livebench_name: lbMatch.matched_name || m.id,
          match_status: lbMatch.status,
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
