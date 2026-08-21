import { NextRequest, NextResponse } from 'next/server';
import { v4 as uuidv4 } from 'uuid';
import { jobManager } from '@/lib/jobs';

export const maxDuration = 60;
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    const intent = typeof body.intent === 'string' && body.intent.trim() ? body.intent.trim() : null;
    const tier = (body.tier === 'right' ? 'right' : 'fast') as 'fast' | 'right';
    const modelOverride = typeof body.model_override === 'string' ? body.model_override : undefined;

    // 1. Validation
    if (!query) {
      return NextResponse.json(
        { error: 'enter something to search', code: 'empty_query' },
        { status: 400 }
      );
    }

    // 2. Allocate search_id and register job
    const searchId = uuidv4();
    jobManager.register({
      id: searchId,
      query,
      intent,
      tier,
      modelOverride,
      status: 'pending',
    });

    // 3. Trigger immediate start (will also be picked up by SSE stream)
    jobManager.startIfNotRunning(searchId);

    // 4. Return search_id immediately to navigate
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
