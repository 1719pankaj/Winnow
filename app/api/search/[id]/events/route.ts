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

  // Ensure search is triggered / running if job was registered
  jobManager.startIfNotRunning(searchId);

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
