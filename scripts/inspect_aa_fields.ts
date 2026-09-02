import dotenv from 'dotenv';
dotenv.config();

async function checkAllAAMetrics() {
  const headers: Record<string, string> = {};
  if (process.env.OPEN_ROUTER_API_KEY) {
    headers['Authorization'] = `Bearer ${process.env.OPEN_ROUTER_API_KEY}`;
  }

  const res = await fetch('https://openrouter.ai/api/v1/models', { headers });
  const json: any = await res.json();
  const models = json.data || [];

  // Check all distinct keys inside benchmarks and benchmarks.artificial_analysis
  const benchmarkKeys = new Set<string>();
  const aaKeys = new Set<string>();

  for (const m of models) {
    if (m.benchmarks) {
      for (const k of Object.keys(m.benchmarks)) {
        benchmarkKeys.add(k);
      }
      if (m.benchmarks.artificial_analysis) {
        for (const k of Object.keys(m.benchmarks.artificial_analysis)) {
          aaKeys.add(k);
        }
      }
    }
  }

  console.log('Unique keys under benchmarks:', Array.from(benchmarkKeys));
  console.log('Unique keys under benchmarks.artificial_analysis:', Array.from(aaKeys));

  // Let's print all models that have artificial_analysis metrics to see all fields
  console.log('\nSample models with their entire benchmarks object:');
  const samples = models.filter((m: any) => m.benchmarks?.artificial_analysis).slice(0, 10);
  for (const s of samples) {
    console.log(`- ${s.id}:`, JSON.stringify(s.benchmarks.artificial_analysis));
  }

  // Also let's check a model's endpoints API: /api/v1/models/{author}/{slug}/endpoints
  console.log('\nChecking /endpoints API for google/gemini-3.7-flash:');
  try {
    const epRes = await fetch('https://openrouter.ai/api/v1/models/google/gemini-3.7-flash/endpoints', { headers });
    const epJson = await epRes.json();
    console.log('Endpoints response structure:', JSON.stringify(epJson, null, 2));
  } catch (e) {
    console.error('Endpoints check error:', e);
  }
}

checkAllAAMetrics().catch(console.error);
