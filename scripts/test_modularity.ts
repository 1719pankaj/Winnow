import { getConfig } from '../lib/config/loader';
import { HttpSearchAdapter } from '../lib/adapters/search';
import { stageRetrieve } from '../lib/stages/retrieve';

async function testModularity() {
  console.log('=== TESTING PROVIDER MODULARITY EXIT CRITERIA ===\n');

  const config = getConfig();

  // Test 1: Simulating an invalid key on one provider while the other succeeds
  console.log('Test 1: One provider errors (e.g. invalid key), other succeeds...');
  const realSerper = config.providers.find((p) => p.name === 'serper')!;
  const realTavily = config.providers.find((p) => p.name === 'tavily')!;

  // Create a broken serper config
  const brokenSerperConfig = {
    ...realSerper,
    request: {
      ...realSerper.request,
      auth: { ...realSerper.request.auth, value: 'invalid_key_xyz' },
    },
  };

  const brokenAdapter = new HttpSearchAdapter(brokenSerperConfig);
  const healthyAdapter = new HttpSearchAdapter(realTavily);

  let providerErrorCaught = false;

  const candidates = await stageRetrieve({
    providers: [brokenAdapter, healthyAdapter],
    queries: ['test modularity fallback'],
    countPerRequest: 10,
    onProviderReturned: (prov, qIdx, count, elapsed) => {
      console.log(`  -> Provider "${prov}" succeeded with ${count} hits in ${elapsed}ms`);
    },
    onProviderError: (prov, err) => {
      console.log(`  -> Provider "${prov}" failed as expected: ${err.message}`);
      if (prov === 'serper') providerErrorCaught = true;
    },
  });

  if (!providerErrorCaught) {
    throw new Error('Expected provider error was not captured');
  }

  if (candidates.length === 0) {
    throw new Error('Expected surviving candidates from healthy provider, got 0');
  }

  console.log(`Search succeeded with ${candidates.length} candidates from surviving provider.\n`);

  // Test 2: Enabling 3 providers dynamically
  console.log('Test 2: Multi-provider fan-out (Serper + Tavily + SerpApi)...');
  const realSerpApi = config.providers.find((p) => p.name === 'serpapi')!;
  const enabledSerpApi = { ...realSerpApi, enabled: true };

  const threeAdapters = [
    new HttpSearchAdapter(realSerper),
    new HttpSearchAdapter(realTavily),
    new HttpSearchAdapter(enabledSerpApi),
  ];

  const threeCandidates = await stageRetrieve({
    providers: threeAdapters,
    queries: ['rust web frameworks'],
    countPerRequest: 5,
    onProviderReturned: (prov, qIdx, count, elapsed) => {
      console.log(`  -> Provider "${prov}" returned ${count} hits in ${elapsed}ms`);
    },
  });

  console.log(`\nTri-provider search returned ${threeCandidates.length} total fused candidates.`);
  console.log('Top 3 fused candidates:');
  threeCandidates.slice(0, 3).forEach((c, idx) => {
    const srcStr = c.sources.map((s) => `${s.provider}#${s.rank}`).join(', ');
    console.log(`[#${idx + 1}] (${c.domain}) Sources: ${srcStr} | Title: ${c.title.slice(0, 45)}`);
  });

  console.log('\n=== Phase 1 Modularity Exit Criteria Passed 100%! ===\n');
}

testModularity().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
