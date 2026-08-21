import { getConfig } from '../lib/config/loader';
import { HttpSearchAdapter } from '../lib/adapters/search';
import { stageRetrieve } from '../lib/stages/retrieve';
import { store } from '../lib/store';
import { Trace } from '../lib/types';
import { v4 as uuidv4 } from 'uuid';

async function testRetrieveAndStore() {
  console.log('=== TESTING STAGE 1 RETRIEVE & RRF FUSION ===\n');

  const config = getConfig();
  console.log('Loaded config successfully.');
  console.log(`Enabled providers: ${config.providers.filter((p) => p.enabled).map((p) => p.name).join(', ')}`);

  const rightTier = config.winnow.tiers.right;
  const enabledProviders = config.providers
    .filter((p) => p.enabled && rightTier.providers.includes(p.name))
    .map((p) => new HttpSearchAdapter(p));

  const query = 'rust async runtime production';
  console.log(`\nExecuting parallel fan-out search for: "${query}" across [${enabledProviders.map((p) => p.name).join(', ')}]...`);

  const t0 = Date.now();
  const candidates = await stageRetrieve({
    providers: enabledProviders,
    queries: [query],
    countPerRequest: rightTier.retrieve_count,
    rrfK: config.winnow.fusion.rrf_k,
    maxPerDomain: config.winnow.blocklist.max_per_domain,
    onProviderReturned: (prov, qIdx, count, elapsed) => {
      console.log(`  -> Provider "${prov}" returned ${count} hits in ${elapsed}ms`);
    },
    onProviderError: (prov, err) => {
      console.warn(`  -> Provider "${prov}" failed: ${err.message}`);
    },
  });

  const elapsed = Date.now() - t0;
  console.log(`\nStage 1 Retrieve completed in ${elapsed}ms. Total candidates: ${candidates.length}`);

  const activeCandidates = candidates.filter((c) => !c.dropped_at_stage);
  const droppedCandidates = candidates.filter((c) => c.dropped_at_stage);

  console.log(`Active candidates: ${activeCandidates.length}, Dropped (near-dupe / diversity cap): ${droppedCandidates.length}`);

  console.log('\nTop 8 Fused Candidates (RRF):');
  activeCandidates.slice(0, 8).forEach((c, idx) => {
    const srcStr = c.sources.map((s) => `${s.provider}#${s.rank}`).join(', ');
    console.log(`[#${idx + 1}] (RRF: ${c.fused_score.toFixed(4)}) [${c.domain}] ${c.title.slice(0, 50)}`);
    console.log(`     Sources: ${srcStr} | URL: ${c.url.slice(0, 60)}`);
  });

  // Test Trace Storage & Retrieval in SQLite
  console.log('\n--- Testing SQLite Trace Persistence ---');
  const searchId = uuidv4();
  const trace: Trace = {
    id: searchId,
    created_at: new Date().toISOString(),
    query,
    intent: 'testing trace storage and retrieval',
    tier: 'right',
    model_id: 'llama-3.1-8b',
    status: 'completed',
    elapsed_ms: elapsed,
    prompt_version: 'rerank.v3',
    results: [],
    candidates,
    degraded_reasons: [],
    llm_call_count: 0,
    cache_hit_count: 0,
  };

  await store.saveTrace(trace);
  console.log(`Saved trace ${searchId} to SQLite.`);

  const loadedTrace = await store.getTrace(searchId);
  if (loadedTrace && loadedTrace.id === searchId && loadedTrace.candidates.length === candidates.length) {
    console.log(`Successfully retrieved trace ${searchId} from SQLite (verified ${loadedTrace.candidates.length} candidates).`);
  } else {
    throw new Error('Trace retrieval from SQLite failed');
  }

  console.log('\n=== All Phase 1 Stage 1 & Storage Tests Passed! ===\n');
}

testRetrieveAndStore().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
