import { NextRequest, NextResponse } from 'next/server';
import { eventHub, formatSSE } from '@/lib/events';
import { store } from '@/lib/store';
import { jobManager } from '@/lib/jobs';
import { ProgressEvent } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: searchId } = await params;

  if (!searchId) {
    return NextResponse.json({ error: 'Search ID is required' }, { status: 400 });
  }

  // Support fallback URL query parameters in case client navigated directly or POST was dropped
  const urlQ = req.nextUrl.searchParams.get('q')?.trim();
  const rawTier = req.nextUrl.searchParams.get('tier');
  const urlTier = (rawTier === 'rush' ? 'rush' : rawTier === 'right' ? 'right' : 'fast') as 'rush' | 'fast' | 'right';
  const urlIntent = req.nextUrl.searchParams.get('intent')?.trim() || null;
  const urlModel = req.nextUrl.searchParams.get('m')?.trim() || undefined;

  let existingTrace: any = null;
  try {
    existingTrace = await store.getTrace(searchId);
  } catch (err) {
    console.warn('[Events Route] Failed to check existing trace:', err);
  }

  // If already finished, no need to start any job
  const isFinished = existingTrace && (existingTrace.status === 'completed' || existingTrace.status === 'failed');

  if (!isFinished) {
    if (!jobManager.get(searchId)) {
      if (existingTrace && existingTrace.status === 'running') {
        // Trace already exists and is marked running
        // Check if there are recent events within the last 45s (meaning another worker/process is actively running it)
        let isActivelyRunning = false;
        try {
          const recentEvents = await store.getEvents(searchId);
          if (recentEvents.length > 0) {
            const lastEvt = recentEvents[recentEvents.length - 1];
            const lastTime = new Date(lastEvt.at).getTime();
            if (Date.now() - lastTime < 45000) {
              isActivelyRunning = true;
            }
          }
        } catch {}

        if (!isActivelyRunning) {
          // Stale / abandoned running trace: re-register and resume
          jobManager.register({
            id: searchId,
            query: existingTrace.query,
            intent: existingTrace.intent,
            tier: existingTrace.tier,
            modelOverride: existingTrace.model_id,
            status: 'pending',
          });
          jobManager.startIfNotRunning(searchId);
        }
      } else if (urlQ) {
        // No trace in DB, but URL params supplied by client (e.g. rush mode or direct link)
        jobManager.register({
          id: searchId,
          query: urlQ,
          intent: urlIntent,
          tier: urlTier,
          modelOverride: urlModel,
          status: 'pending',
        });
        jobManager.startIfNotRunning(searchId);
      }
    } else {
      jobManager.startIfNotRunning(searchId);
    }
  }

  const headerLastId = req.headers.get('last-event-id');
  const urlLastId = req.nextUrl.searchParams.get('lastEventId');
  const lastSeq = parseInt(headerLastId || urlLastId || '0', 10) || 0;

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      let isClosed = false;

      const safeEnqueue = (text: string) => {
        if (!isClosed) {
          try {
            controller.enqueue(encoder.encode(text));
          } catch {
            isClosed = true;
          }
        }
      };

      // 1. Replay buffered events from SQLite
      const bufferedEvents = await store.getEventsSince(searchId, lastSeq);
      for (const evt of bufferedEvents) {
        safeEnqueue(formatSSE(evt));
      }

      // Check if search is already completed
      const trace = await store.getTrace(searchId);
      if (trace && (trace.status === 'completed' || trace.status === 'failed')) {
        const hasDone = bufferedEvents.some((e: any) => e.type === 'done' || e.type === 'error');
        if (!hasDone) {
          safeEnqueue(
            formatSSE({
              id: (bufferedEvents[bufferedEvents.length - 1]?.id || 0) + 1,
              type: trace.status === 'completed' ? 'done' : 'error',
              data: {
                elapsed_ms: trace.elapsed_ms,
                total_llm_calls: trace.llm_call_count,
                cache_hits: trace.cache_hit_count,
              },
              at: new Date().toISOString(),
            })
          );
        }
        try { controller.close(); } catch {}
        isClosed = true;
        return;
      }

      // 2. Subscribe to live events
      const unsubscribe = eventHub.subscribe(searchId, (evt: ProgressEvent) => {
        safeEnqueue(formatSSE(evt));
        if (evt.type === 'done' || evt.type === 'error') {
          unsubscribe();
          setTimeout(() => {
            if (!isClosed) {
              try { controller.close(); } catch {}
              isClosed = true;
            }
          }, 200);
        }
      });

      // 3. Keepalive heartbeat
      const pingInterval = setInterval(() => {
        if (!isClosed) {
          safeEnqueue(': ping\n\n');
        } else {
          clearInterval(pingInterval);
        }
      }, 10000);

      req.signal.addEventListener('abort', () => {
        isClosed = true;
        unsubscribe();
        clearInterval(pingInterval);
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
