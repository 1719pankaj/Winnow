/**
 * Core Model Ping Engine & Automated 4-Hour Background Monitor
 * 
 * Rules:
 * 1. 5-second hard timeout for returning "OK" (any model taking > 5s is marked as Fail).
 * 2. Automated server cron executes every 4 hours, persisting benchmark numbers to Turso DB.
 * 3. Search depth slider filters out any endpoint taking > 3s (3000ms).
 */

import { loadConfig } from './config/loader';
import { fetchOpenRouterModels, matchOpenRouterModel } from './benchmarks';
import { fetchNimModels, fetchGroqModels, fetchGoogleGeminiModels } from './provider_catalog';
import { store } from './store';

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

function maskApiKey(key?: string): string {
  if (!key) return '(not provided)';
  if (key.length <= 8) return '********';
  return `${key.slice(0, 4)}...${key.slice(-4)}`;
}

/**
 * Execute a ping test with a strict 5-second timeout
 */
export async function executePing(provider: any, model: any): Promise<PingTrace> {
  const t0 = Date.now();
  const timestamp = new Date().toISOString();
  const TIMEOUT_MS = 5000; // Hard 5-second cutoff rule

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
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

      const maskedHeaders = { 'Content-Type': 'application/json' };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: maskedHeaders,
        body: JSON.stringify(bodyObj),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const latency_ms = Date.now() - t0;
      const rawText = await res.text();
      let parsedBody: any;
      try {
        parsedBody = JSON.parse(rawText);
      } catch {
        parsedBody = null;
      }

      // Check 5-second rule and HTTP status
      if (latency_ms > TIMEOUT_MS) {
        return {
          model_id: model.id,
          provider: provider.name,
          model_string: model.model_string,
          endpoint_url: maskedEndpoint,
          method: 'POST',
          request_headers: maskedHeaders,
          request_body: bodyObj,
          response_status: res.status,
          response_status_text: 'Timeout Exceeded (> 5s)',
          response_body: parsedBody,
          response_raw_text: rawText,
          latency_ms,
          error: `Ping failed: Model took ${latency_ms}ms (> 5.0s timeout cutoff)`,
          timestamp,
        };
      }

      if (!res.ok) {
        return {
          model_id: model.id,
          provider: provider.name,
          model_string: model.model_string,
          endpoint_url: maskedEndpoint,
          method: 'POST',
          request_headers: maskedHeaders,
          request_body: bodyObj,
          response_status: res.status,
          response_status_text: res.statusText,
          response_body: parsedBody,
          response_raw_text: rawText,
          latency_ms,
          error: parsedBody?.error?.message || `HTTP ${res.status}: ${res.statusText}`,
          timestamp,
        };
      }

      return {
        model_id: model.id,
        provider: provider.name,
        model_string: model.model_string,
        endpoint_url: maskedEndpoint,
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
    } else {
      // OpenAI Compatible Provider (Groq, NIM, OpenRouter)
      const apiKey = provider.api_key || '';
      const baseUrl = provider.base_url.replace(/\/$/, '');
      const endpoint = `${baseUrl}/chat/completions`;

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        ...(provider.extra_headers || {}),
      };

      const maskedHeaders: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${maskApiKey(apiKey)}`,
        ...(provider.extra_headers || {}),
      };

      const bodyObj = {
        model: model.model_string,
        messages: [{ role: 'user', content: 'Say "OK"' }],
        max_tokens: 10,
        temperature: 0.1,
      };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(bodyObj),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const latency_ms = Date.now() - t0;
      const rawText = await res.text();
      let parsedBody: any;
      try {
        parsedBody = JSON.parse(rawText);
      } catch {
        parsedBody = null;
      }

      // Check 5-second rule and HTTP status
      if (latency_ms > TIMEOUT_MS) {
        return {
          model_id: model.id,
          provider: provider.name,
          model_string: model.model_string,
          endpoint_url: endpoint,
          method: 'POST',
          request_headers: maskedHeaders,
          request_body: bodyObj,
          response_status: res.status,
          response_status_text: 'Timeout Exceeded (> 5s)',
          response_body: parsedBody,
          response_raw_text: rawText,
          latency_ms,
          error: `Ping failed: Model took ${latency_ms}ms (> 5.0s timeout cutoff)`,
          timestamp,
        };
      }

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
          error: parsedBody?.error?.message || `HTTP ${res.status}: ${res.statusText}`,
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
    }
  } catch (err: any) {
    clearTimeout(timeoutId);
    const latency_ms = Date.now() - t0;
    const isTimeout = err.name === 'AbortError' || latency_ms >= TIMEOUT_MS;

    return {
      model_id: model.id,
      provider: provider.name,
      model_string: model.model_string,
      endpoint_url: provider.name === 'gemini' ? 'https://generativelanguage.googleapis.com' : (provider.base_url || ''),
      method: 'POST',
      request_headers: { 'Content-Type': 'application/json' },
      request_body: { messages: [{ role: 'user', content: 'Say "OK"' }] },
      response_status: 0,
      response_status_text: isTimeout ? 'Timeout Failed (> 5s)' : 'Network Error',
      latency_ms,
      error: isTimeout
        ? 'Ping failed: Model failed to return OK within 5.0 seconds (timeout cutoff)'
        : (err.message || 'Connection failed'),
      timestamp,
    };
  }
}

/**
 * Ping all active models and save latency results into Turso DB
 */
export async function runAllModelPings(): Promise<{ pinged: number; success: number; failed: number }> {
  await store.init();
  const config = loadConfig();
  const providers = config.inference.inference_providers;
  const provMap = new Map(providers.map((p) => [p.name, p]));

  const geminiProvider = provMap.get('gemini');
  const nimProvider = provMap.get('nim');
  const groqProvider = provMap.get('groq');

  const [orModels, googleModels, nimModels, groqModels] = await Promise.all([
    fetchOpenRouterModels(),
    fetchGoogleGeminiModels(geminiProvider?.api_key),
    fetchNimModels(nimProvider?.api_key),
    fetchGroqModels(groqProvider?.api_key),
  ]);

  const allModels: any[] = [...config.inference.models];

  for (const nm of nimModels) {
    allModels.push({
      id: `nim-live-${nm.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
      provider: 'nim',
      model_string: nm.id,
    });
  }

  for (const gm of groqModels) {
    allModels.push({
      id: `groq-live-${gm.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
      provider: 'groq',
      model_string: gm.id,
    });
  }

  for (const gm of googleModels) {
    const raw = gm.name.replace(/^models\//, '');
    allModels.push({
      id: `gemini-live-${raw.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
      provider: 'gemini',
      model_string: raw,
    });
  }

  const cachedDbCards = await store.getCachedModelCards();
  const dbCardMap = new Map(cachedDbCards.map((c) => [c.id, c]));

  let success = 0;
  let failed = 0;

  const eligibleModels = allModels.filter((m) => {
    const p = provMap.get(m.provider);
    if (!p || !p.enabled) return false;
    const dbCard = dbCardMap.get(m.id);
    if (dbCard?.status_override === 'disabled' || dbCard?.status_override === 'incompatible') {
      return false;
    }
    return true;
  });

  console.log(`[Scheduled Model Ping] Starting 4-hour ping for ${eligibleModels.length} active models (concurrency: 6)...`);

  const BATCH_SIZE = 6;
  for (let i = 0; i < eligibleModels.length; i += BATCH_SIZE) {
    const batch = eligibleModels.slice(i, i + BATCH_SIZE);
    await Promise.all(
      batch.map(async (m) => {
        const p = provMap.get(m.provider)!;
        const dbCard = dbCardMap.get(m.id);
        try {
          const trace = await executePing(p, m);
          const isOk =
            trace.response_status >= 200 &&
            trace.response_status < 300 &&
            !trace.error &&
            trace.latency_ms <= 5000;

          if (isOk) success++;
          else failed++;

          const match = matchOpenRouterModel(m.id, m.model_string, m.id, orModels);
          const aa = match.matched_model?.benchmarks?.artificial_analysis;

          await store.saveCachedModelCard({
            id: m.id,
            provider: m.provider,
            model_string: m.model_string,
            tested_latency_ms: trace.latency_ms,
            tested_status: isOk ? 'ok' : 'fail',
            tested_error: trace.error,
            intelligence_index: aa?.intelligence_index ?? dbCard?.intelligence_index,
            coding_index: aa?.coding_index ?? dbCard?.coding_index,
            agentic_index: aa?.agentic_index ?? dbCard?.agentic_index,
            openrouter_id: match.matched_model?.id,
            context_length: match.matched_model?.context_length ?? dbCard?.context_length,
            match_status: match.status,
            status_override: dbCard?.status_override,
            updated_at: new Date().toISOString(),
          });
        } catch (err: any) {
          failed++;
          console.error(`[Scheduled Model Ping Error] ${m.id}:`, err.message);
        }
      })
    );
  }

  console.log(`[Scheduled Model Ping] Completed: ${success} passed, ${failed} failed.`);
  return { pinged: success + failed, success, failed };
}

/**
 * Singleton timer for background recurring ping every 4 hours
 */
let cronTimer: NodeJS.Timeout | null = null;

export function initScheduledPings() {
  if (cronTimer) return; // Already running

  const FOUR_HOURS_MS = 4 * 60 * 60 * 1000;

  // Run initial ping check in background after 10 seconds of server startup
  setTimeout(() => {
    runAllModelPings().catch(console.error);
  }, 10000);

  // Schedule every 4 hours recurring
  cronTimer = setInterval(() => {
    runAllModelPings().catch(console.error);
  }, FOUR_HOURS_MS);

  console.log('[Scheduled Model Ping] 4-hour background ping timer registered.');
}
