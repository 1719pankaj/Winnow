import dotenv from 'dotenv';
dotenv.config();

import { SearchOrchestrator } from '../lib/orchestrator';
import { store } from '../lib/store';
import { v4 as uuidv4 } from 'uuid';

async function testLiveSearch() {
  console.log('Testing live orchestrator search execution with Turso persistence...');
  const searchId = uuidv4();
  const orchestrator = new SearchOrchestrator(searchId, (evt) => {
    console.log(`  [Event ${evt.id}] ${evt.type}`);
  });

  const trace = await orchestrator.run({
    query: 'rust web frameworks',
    intent: 'fast lightweight microservice API with high RPS',
    tier: 'fast',
  });

  console.log(`\nSearch finished with status: ${trace.status}`);
  console.log(`Results count: ${trace.results.length}`);
  console.log(`Elapsed ms: ${trace.elapsed_ms}`);

  const loaded = await store.getTrace(searchId);
  if (loaded && loaded.audit) {
    console.log(`Successfully verified Turso trace retrieval with full audit data (${loaded.results.length} results)!`);
  } else {
    throw new Error('Trace retrieval failed');
  }
}

testLiveSearch().catch((err) => {
  console.error('Search failed:', err);
  process.exit(1);
});
