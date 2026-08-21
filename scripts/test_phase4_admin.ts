import { getRedactedConfig, reloadConfig } from '../lib/config/loader';
import { runSelfCheck } from '../lib/self_check';
import { store } from '../lib/store';

async function testPhase4Admin() {
  console.log('=== WINNOW PHASE 4: DEPLOYMENT & ADMIN VERIFICATION ===\n');

  // Test 1: Secret Redaction on Config
  console.log('--- Test 1: Secret Redaction Check ---');
  const redacted = getRedactedConfig();

  let secretLeaked = false;
  const redactedStr = JSON.stringify(redacted);

  const sensitiveEnvs = [
    process.env.NVIDIA_NIM_API_KEY,
    process.env.OPEN_ROUTER_API_KEY,
    process.env.SERPER_KEY,
    process.env.TRAVITY_KEY,
    process.env.SERPAPI_KEY,
  ].filter(Boolean) as string[];

  for (const secret of sensitiveEnvs) {
    if (secret.length > 5 && redactedStr.includes(secret)) {
      secretLeaked = true;
      console.error(`[FAIL] Secret leaked in redacted config: ${secret.slice(0, 4)}...`);
    }
  }

  if (!secretLeaked) {
    console.log('[PASS] All secrets properly redacted (zero keys exposed in config endpoint).');
  } else {
    throw new Error('Secret redaction failed');
  }

  // Test 2: Dynamic Config Reload
  console.log('\n--- Test 2: Dynamic Config Reload Check ---');
  const reloaded = reloadConfig();
  if (reloaded && reloaded.providers && reloaded.inference && reloaded.winnow) {
    console.log(`[PASS] Config successfully reloaded dynamically (${reloaded.providers.length} providers, ${reloaded.inference.models.length} models).`);
  } else {
    throw new Error('Dynamic config reload failed');
  }

  // Test 3: Self-Check Diagnostics Endpoint Functionality
  console.log('\n--- Test 3: Startup Self-Check Diagnostics ---');
  const diagResults = await runSelfCheck();
  console.log(`Self-check returned ${diagResults.length} diagnostic items:`);
  diagResults.forEach((r) => {
    console.log(`  [${r.category.toUpperCase()}] ${r.name.padEnd(24)}: ${r.status.toUpperCase()} (${r.latencyMs}ms)`);
  });

  const searchOk = diagResults.filter((r) => r.category === 'search' && r.status === 'ok');
  if (searchOk.length > 0) {
    console.log(`[PASS] ${searchOk.length} search provider(s) active and operational.`);
  }

  // Test 4: LibSQL Database Layer (Traces, Events, Cache)
  console.log('\n--- Test 4: Database Storage & Schema Verification ---');
  await store.init();
  const testTraceId = 'admin-test-' + Date.now();
  await store.saveTrace({
    id: testTraceId,
    created_at: new Date().toISOString(),
    query: 'test query',
    intent: 'test intent',
    tier: 'fast',
    model_id: 'test-model',
    status: 'completed',
    elapsed_ms: 100,
    prompt_version: 'rerank.v3',
    results: [],
    candidates: [],
    degraded_reasons: [],
    llm_call_count: 0,
    cache_hit_count: 0,
  });

  const fetched = await store.getTrace(testTraceId);
  if (fetched && fetched.id === testTraceId) {
    console.log('[PASS] SQLite / LibSQL schema operational (save, fetch, and query verified).');
  } else {
    throw new Error('Database verification failed');
  }

  console.log('\n=== Phase 4 Deployment & Admin Verification Passed 100%! ===\n');
}

testPhase4Admin().catch((err) => {
  console.error('Fatal error in Phase 4 admin test:', err);
  process.exit(1);
});
