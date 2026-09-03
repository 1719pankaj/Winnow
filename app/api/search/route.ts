import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { jobManager } from '@/lib/jobs';
import { store } from '@/lib/store';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    const intent = typeof body.intent === 'string' && body.intent.trim() ? body.intent.trim() : null;
    const tier = (body.tier === 'right' ? 'right' : 'fast') as 'fast' | 'right';
    const rawModel = body.model_id || body.model_override;
    const modelOverride = typeof rawModel === 'string' && rawModel.trim() && rawModel !== 'auto' ? rawModel.trim() : undefined;

    // 1. Validation
    if (!query) {
      return NextResponse.json(
        { error: 'enter something to search', code: 'empty_query' },
        { status: 400 }
      );
    }

    // 2. Allocate search_id
    const searchId = uuidv4();

    // 3. Persist initial trace to database immediately so trace endpoint never 404s
    await store.init();
    const initialTrace = {
      id: searchId,
      created_at: new Date().toISOString(),
      query,
      intent,
      tier,
      model_id: modelOverride || 'auto',
      status: 'running',
      elapsed_ms: 0,
      prompt_version: 'rerank.v3',
      results: [],
      candidates: [],
      degraded_reasons: [],
      llm_call_count: 0,
      cache_hit_count: 0,
      audit: {
        deliberation_log: [{
          timestamp: new Date().toISOString(),
          stage: 'init',
          message: `Search initialized for "${query}" (Tier: ${tier.toUpperCase()})`,
        }],
      },
    };
    try {
      await store.saveTrace(initialTrace as any);
    } catch (saveErr) {
      console.warn('[API /api/search] Initial trace save warning:', saveErr);
    }

    // 4. Register and trigger job
    jobManager.register({
      id: searchId,
      query,
      intent,
      tier,
      modelOverride,
      status: 'pending',
    });

    jobManager.startIfNotRunning(searchId);

    // 5. Return search_id immediately to navigate
    return NextResponse.json({
      search_id: searchId,
      status: 'pending',
    });
  } catch (err: any) {
    console.error('[API /api/search Error]', err);
    return NextResponse.json(
      { error: err.message || 'Internal server error', code: 'search_failed' },
      { status: 500 }
    );
  }
}
