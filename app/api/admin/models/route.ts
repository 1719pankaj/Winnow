import { NextRequest, NextResponse } from 'next/server';
import { loadConfig } from '@/lib/config/loader';
import { fetchOpenRouterModels, matchOpenRouterModel } from '@/lib/benchmarks';
import { store, CachedModelCard } from '@/lib/store';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export interface PingTrace {
  model_id: string;
  provider: string;
  model_string: string;
  endpoint_url: string;
  method: string;
  request_headers: Record<string, string>;
  request_body: any;
  response_status: number;
  response_status_text: string;
  response_body?: any;
  response_raw_text?: string;
  latency_ms: number;
  error?: string;
  timestamp: string;
}

export interface ModelBenchmarkItem {
  id: string;
  provider: string;
  model_string: string;
  benchmark_hint?: string;
  role: string[];
  capabilities: any;
  time_per_task_s: number;
  tested_latency_ms?: number;
  tested_status: 'ok' | 'fail' | 'disabled' | 'untested';
  tested_error?: string;
  ping_trace?: PingTrace;
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

function estimateTimePerTask(m: any, match: any): number {
  if (m.provider === 'cerebras') return 0.15;
  if (m.provider === 'groq') return 0.35;
  if (m.id.includes('gemini-3.7')) return 1.8;
  if (m.id.includes('gemini-3.6')) return 1.5;
  if (m.id.includes('gemini-3.5')) return 1.2;
  if (m.id.includes('glm-5.3')) return 1.4;
  if (m.id.includes('glm-5.2')) return 1.9;
  if (m.id.includes('deepseek-v4')) return 2.2;
  if (m.id.includes('nemotron-3-ultra')) return 1.6;
  if (m.id.includes('minimax-m3')) return 2.1;
  if (m.id.includes('inkling')) return 1.5;
  if (m.id.includes('gemma-4-31b')) return m.provider === 'cerebras' ? 0.15 : 1.7;
  if (m.id.includes('legacy')) return 2.8;
  return 1.8;
}

function maskApiKey(key?: string): string {
  if (!key) return '(not provided)';
  if (key.length <= 8) return '********';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

async function executePing(provider: any, model: any): Promise<PingTrace> {
  const t0 = Date.now();
  const timestamp = new Date().toISOString();

  if (provider.name === 'gemini') {
    const apiKey = provider.api_key || process.env.GEMINI_AI_STUDIO_KEY || '';
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model.model_string}:generateContent?key=${apiKey}`;
    const maskedEndpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model.model_string}:generateContent?key=${maskApiKey(apiKey)}`;

    const bodyObj: any = {
      contents: [{ parts: [{ text: 'Say "OK"' }] }],
      generationConfig: {
        maxOutputTokens: 10,
        temperature: 0.1,
      },
    };

    if (model.capabilities?.thinking_budget) {
      bodyObj.generationConfig.thinkingConfig = {
        thinkingBudget: model.capabilities.thinking_budget,
      };
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(bodyObj),
        signal: AbortSignal.timeout(12000),
      });

      const latency_ms = Date.now() - t0;
      const rawText = await res.text();
      let parsedBody = undefined;
      try {
        parsedBody = JSON.parse(rawText);
      } catch {}

      if (!res.ok) {
        return {
          model_id: model.id,
          provider: provider.name,
          model_string: model.model_string,
          endpoint_url: maskedEndpoint,
          method: 'POST',
          request_headers: headers,
          request_body: bodyObj,
          response_status: res.status,
          response_status_text: res.statusText,
          response_body: parsedBody,
          response_raw_text: rawText,
          latency_ms,
          error: `HTTP ${res.status}: ${res.statusText}`,
          timestamp,
        };
      }

      return {
        model_id: model.id,
        provider: provider.name,
        model_string: model.model_string,
        endpoint_url: maskedEndpoint,
        method: 'POST',
        request_headers: headers,
        request_body: bodyObj,
        response_status: res.status,
        response_status_text: res.statusText,
        response_body: parsedBody,
        response_raw_text: rawText,
        latency_ms,
        timestamp,
      };
    } catch (err: any) {
      return {
        model_id: model.id,
        provider: provider.name,
        model_string: model.model_string,
        endpoint_url: maskedEndpoint,
        method: 'POST',
        request_headers: headers,
        request_body: bodyObj,
        response_status: 0,
        response_status_text: 'Network / Timeout Error',
        latency_ms: Date.now() - t0,
        error: err.message || 'Connection failed',
        timestamp,
      };
    }
  } else {
    // OpenAI-compatible providers: Groq, Cerebras, OpenRouter, NIM
    const endpoint = `${provider.base_url.replace(/\/+$/, '')}/chat/completions`;
    const apiKey = provider.api_key || '';
    const maskedHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${maskApiKey(apiKey)}`,
      ...(provider.extra_headers || {}),
    };
    const realHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      ...(provider.extra_headers || {}),
    };

    const bodyObj: any = {
      model: model.model_string,
      messages: [{ role: 'user', content: 'Say "OK"' }],
      max_tokens: 10,
      temperature: 0.1,
    };

    if (model.capabilities?.reasoning_effort) {
      bodyObj.reasoning_effort = model.capabilities.reasoning_effort;
    }

    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: realHeaders,
        body: JSON.stringify(bodyObj),
        signal: AbortSignal.timeout(12000),
      });

      const latency_ms = Date.now() - t0;
      const rawText = await res.text();
      let parsedBody = undefined;
      try {
        parsedBody = JSON.parse(rawText);
      } catch {}

      if (!res.ok) {
        return {
          model_id: model.id,
          provider: provider.name,
          model_string: model.model_string,
          endpoint_url: endpoint,
          method: 'POST',
          request_headers: maskedHeaders,
          request_body: bodyObj,
          response_status: res.status,
          response_status_text: res.statusText,
          response_body: parsedBody,
          response_raw_text: rawText,
          latency_ms,
          error: `HTTP ${res.status}: ${res.statusText}`,
          timestamp,
        };
      }

      return {
        model_id: model.id,
        provider: provider.name,
        model_string: model.model_string,
        endpoint_url: endpoint,
        method: 'POST',
        request_headers: maskedHeaders,
        request_body: bodyObj,
        response_status: res.status,
        response_status_text: res.statusText,
        response_body: parsedBody,
        response_raw_text: rawText,
        latency_ms,
        timestamp,
      };
    } catch (err: any) {
      return {
        model_id: model.id,
        provider: provider.name,
        model_string: model.model_string,
        endpoint_url: endpoint,
        method: 'POST',
        request_headers: maskedHeaders,
        request_body: bodyObj,
        response_status: 0,
        response_status_text: 'Network / Timeout Error',
        latency_ms: Date.now() - t0,
        error: err.message || 'Connection failed',
        timestamp,
      };
    }
  }
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
      const match = matchOpenRouterModel(m.id, m.model_string, (m as any).benchmark_hint || m.id, orModels);
      const aa = match.matched_model?.benchmarks?.artificial_analysis;

      const item: ModelBenchmarkItem = {
        id: m.id,
        provider: m.provider,
        model_string: m.model_string,
        benchmark_hint: (m as any).benchmark_hint,
        role: m.role,
        capabilities: m.capabilities,
        time_per_task_s: estimateTimePerTask(m, match),
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
      const match = matchOpenRouterModel(m.id, m.model_string, (m as any).benchmark_hint || m.id, orModels);
      const aa = match.matched_model?.benchmarks?.artificial_analysis;

      if (!p || !p.enabled) {
        const item: ModelBenchmarkItem = {
          id: m.id,
          provider: m.provider,
          model_string: m.model_string,
          benchmark_hint: (m as any).benchmark_hint,
          role: m.role,
          capabilities: m.capabilities,
          time_per_task_s: estimateTimePerTask(m, match),
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

      // Execute live ping with full request/response trace capture
      const pingTrace = await executePing(p, m);
      const isOk = pingTrace.response_status >= 200 && pingTrace.response_status < 300;

      const item: ModelBenchmarkItem = {
        id: m.id,
        provider: m.provider,
        model_string: m.model_string,
        benchmark_hint: (m as any).benchmark_hint,
        role: m.role,
        capabilities: m.capabilities,
        time_per_task_s: estimateTimePerTask(m, match),
        tested_latency_ms: pingTrace.latency_ms,
        tested_status: isOk ? 'ok' : 'fail',
        tested_error: isOk ? undefined : (pingTrace.error || `HTTP ${pingTrace.response_status}`),
        ping_trace: pingTrace,
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
        tested_latency_ms: pingTrace.latency_ms,
        tested_status: isOk ? 'ok' : 'fail',
        tested_error: isOk ? undefined : pingTrace.error,
        capabilities_json: JSON.stringify(m.capabilities),
        updated_at: new Date().toISOString(),
      });

      benchmarkResults.push(item);
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
