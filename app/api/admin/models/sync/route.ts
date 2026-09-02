import { NextRequest, NextResponse } from 'next/server';
import { syncLiveModelCatalog } from '@/lib/catalog';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const catalog = await syncLiveModelCatalog();
    return NextResponse.json({
      success: true,
      count: catalog.length,
      models: catalog,
      synced_at: new Date().toISOString(),
    });
  } catch (err: any) {
    console.error('[API /api/admin/models/sync Error]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
