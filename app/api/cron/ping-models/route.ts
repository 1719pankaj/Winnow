import { NextRequest, NextResponse } from 'next/server';
import { runAllModelPings } from '@/lib/pings';

export const maxDuration = 300; // 5 minute max duration for full cron
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest) {
  try {
    const result = await runAllModelPings();
    return NextResponse.json({
      status: 'completed',
      ...result,
      timestamp: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[API /api/cron/ping-models Error]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  return GET(req);
}
