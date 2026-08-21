import dotenv from 'dotenv';
dotenv.config();

import { store } from '../lib/store';
import { v4 as uuidv4 } from 'uuid';

async function verifyTurso() {
  console.log('=== VERIFYING TURSO CLOUD DATABASE CONNECTION ===\n');
  console.log(`Database URL: ${process.env.TURSO_DATABASE_URL}`);
  console.log(`Auth Token present: ${Boolean(process.env.TURSO_AUTH_TOKEN)}\n`);

  const t0 = Date.now();
  console.log('1. Initializing schema tables on Turso cloud database...');
  await store.init();
  console.log(`Schema tables initialized successfully in ${Date.now() - t0}ms.`);

  const testId = uuidv4();
  console.log(`\n2. Writing a test search trace to Turso (${testId})...`);
  await store.saveTrace({
    id: testId,
    created_at: new Date().toISOString(),
    query: 'turso cloud verification',
    intent: 'testing cloud libsql remote persistence',
    tier: 'fast',
    model_id: 'llama-3.1-8b',
    status: 'completed',
    elapsed_ms: 240,
    prompt_version: 'rerank.v3',
    results: [
      {
        rank: 1,
        url: 'https://turso.tech',
        domain: 'turso.tech',
        title: 'Turso - SQLite for the Edge',
        snippet: 'Turso is an edge database based on LibSQL.',
        score: 98,
        rationale: 'Official Turso platform documentation.',
        provenance: {
          providers: [{ provider: 'serper', rank: 1 }],
          original_best_rank: 1,
          rank_delta: 0,
          prefilter_score: 0.95,
          was_read: false,
          penalties: [],
        },
      },
    ],
    candidates: [],
    degraded_reasons: [],
    llm_call_count: 1,
    cache_hit_count: 0,
  });
  console.log('Trace saved to Turso.');

  console.log('\n3. Retrieving trace back from Turso...');
  const trace = await store.getTrace(testId);
  if (trace && trace.id === testId && trace.results.length === 1) {
    console.log(`Successfully verified trace retrieval: "${trace.results[0].title}" (Score: ${trace.results[0].score})`);
    console.log('\n=== Turso Database is 100% Active & Operational! ===\n');
  } else {
    throw new Error('Could not retrieve trace from Turso');
  }
}

verifyTurso().catch((err) => {
  console.error('Turso verification error:', err);
  process.exit(1);
});
