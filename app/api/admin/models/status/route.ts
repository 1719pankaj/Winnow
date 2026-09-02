import { NextRequest, NextResponse } from 'next/server';
import { store } from '@/lib/store';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { model_id, status } = body;

    if (!model_id || typeof model_id !== 'string') {
      return NextResponse.json({ error: 'model_id is required' }, { status: 400 });
    }

    const validStatuses = ['active', 'outdated', 'incompatible', 'disabled'];
    const newStatus = status === null || status === undefined || status === 'default' 
      ? null 
      : validStatuses.includes(status) ? status : null;

    await store.setModelStatusOverride(model_id, newStatus);

    return NextResponse.json({
      success: true,
      model_id,
      status: newStatus,
      message: `Model ${model_id} status set to ${newStatus || 'default'}`,
    });
  } catch (err: any) {
    console.error('[API /api/admin/models/status Error]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
