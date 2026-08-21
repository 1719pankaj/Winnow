import { NextRequest, NextResponse } from 'next/server';
import { store } from '@/lib/store';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json({ error: 'Search ID is required' }, { status: 400 });
    }

    const trace = await store.getTrace(id);
    if (!trace) {
      return NextResponse.json({ error: 'Trace not found' }, { status: 404 });
    }

    return NextResponse.json(trace);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
