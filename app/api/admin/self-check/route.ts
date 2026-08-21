import { NextResponse } from 'next/server';
import { runSelfCheck } from '@/lib/self_check';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const results = await runSelfCheck();
    return NextResponse.json({ status: 'complete', results });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
