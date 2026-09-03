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
    const rawTier = body.tier;
    const tier = (rawTier === 'rush' ? 'rush' : rawTier === 'right' ? 'right' : 'fast') as 'rush' | 'fast' | 'right';
    const rawModel = body.model_id || body.model_override;
    const modelOverride = typeof rawModel === 'string' && rawModel.trim() && rawModel !== 'auto' ? rawModel.trim() : undefined;

    // 1. Validation
    if (!query) {
      return NextResponse.json(
        { error: 'enter something to search', code: 'empty_query' },
        { status: 400 }
      );
    }

    // 2. Allocate or accept client-generated search_id
    const searchId = (typeof body.search_id === 'string' && body.search_id.trim()) ? body.search_id.trim() : uuidv4();

    // 3. Register and trigger search job immediately in-memory
    jobManager.register({
      id: searchId,
      query,
      intent,
      tier,
      modelOverride,
      status: 'pending',
    });

    jobManager.startIfNotRunning(searchId);

    // 4. Persist initial trace asynchronously (never blocks the client navigation)
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

    store.saveTrace(initialTrace as any).catch((saveErr) => {
      console.warn('[API /api/search] Initial trace background save warning:', saveErr);
    });

    // 5. Return search_id immediately to navigate instantly
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
