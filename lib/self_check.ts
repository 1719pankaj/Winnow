import { getConfig } from './config/loader';
import { HttpSearchAdapter } from './adapters/search';
import { InferenceAdapter } from './adapters/inference';

export interface DiagnosticResult {
  category: 'search' | 'inference';
  name: string;
  status: 'ok' | 'fail' | 'disabled';
  latencyMs: number;
  message?: string;
}

export async function runSelfCheck(): Promise<DiagnosticResult[]> {
  const config = getConfig();
  const results: DiagnosticResult[] = [];

  console.log('=== WINNOW STARTUP DIAGNOSTICS ===\n');

  // 1. Check Search Providers
  console.log('--- Checking Search Providers ---');
  for (const pConfig of config.providers) {
    if (!pConfig.enabled) {
      results.push({
        category: 'search',
        name: pConfig.name,
        status: 'disabled',
        latencyMs: 0,
        message: 'Disabled in providers.yaml',
      });
      continue;
    }

    const adapter = new HttpSearchAdapter(pConfig);
    const t0 = Date.now();
    try {
      const hits = await adapter.search('test query', 3);
      const elapsed = Date.now() - t0;
      console.log(`[Search] ${pConfig.name.padEnd(12)}: OK (${elapsed}ms, ${hits.length} hits)`);
      results.push({
        category: 'search',
        name: pConfig.name,
        status: 'ok',
        latencyMs: elapsed,
        message: `Returned ${hits.length} results`,
      });
    } catch (err: any) {
      const elapsed = Date.now() - t0;
      console.log(`[Search] ${pConfig.name.padEnd(12)}: FAIL (${elapsed}ms) -> ${err.message}`);
      results.push({
        category: 'search',
        name: pConfig.name,
        status: 'fail',
        latencyMs: elapsed,
        message: err.message,
      });
    }
  }

  // 2. Check Inference Providers and Models in Fallback Chain
  console.log('\n--- Checking Inference Models (Fallback Chain) ---');
  const infProvidersMap = new Map(
    config.inference.inference_providers.map((ip) => [ip.name, ip])
  );
  const modelsMap = new Map(config.inference.models.map((m) => [m.id, m]));

  for (const modelId of config.inference.model_policy.fallback_chain) {
    const modelConfig = modelsMap.get(modelId);
    if (!modelConfig) {
      results.push({
        category: 'inference',
        name: modelId,
        status: 'fail',
        latencyMs: 0,
        message: 'Model not found in inference.yaml models list',
      });
      continue;
    }

    const providerConfig = infProvidersMap.get(modelConfig.provider);
    if (!providerConfig || !providerConfig.enabled) {
      results.push({
        category: 'inference',
        name: modelId,
        status: 'disabled',
        latencyMs: 0,
        message: `Provider ${modelConfig.provider} disabled`,
      });
      continue;
    }

    const adapter = new InferenceAdapter(providerConfig, modelConfig);
    const t0 = Date.now();
    try {
      const completionPromise = adapter.complete([
        { role: 'user', content: 'Reply with "OK" only.' },
      ], { maxTokens: 10 });

      const timeoutPromise = new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('Timed out after 10000ms')), 10000)
      );

      const response = await Promise.race([completionPromise, timeoutPromise]);
      const elapsed = Date.now() - t0;
      console.log(`[Inference] ${modelId.padEnd(24)} (${modelConfig.provider}): OK (${elapsed}ms) -> "${response.trim()}"`);
      results.push({
        category: 'inference',
        name: modelId,
        status: 'ok',
        latencyMs: elapsed,
        message: `Response: "${response.trim()}"`,
      });
    } catch (err: any) {
      const elapsed = Date.now() - t0;
      console.log(`[Inference] ${modelId.padEnd(24)} (${modelConfig.provider}): FAIL (${elapsed}ms) -> ${err.message}`);
      results.push({
        category: 'inference',
        name: modelId,
        status: 'fail',
        latencyMs: elapsed,
        message: err.message,
      });
    }
  }

  console.log('\n===================================\n');
  return results;
}
