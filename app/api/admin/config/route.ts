import { NextResponse } from 'next/server';
import { getRedactedConfig, reloadConfig } from '@/lib/config/loader';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const config = getRedactedConfig();
    return NextResponse.json(config);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST() {
  try {
    const reloaded = reloadConfig();
    return NextResponse.json({ status: 'reloaded', config: getRedactedConfig(reloaded) });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
