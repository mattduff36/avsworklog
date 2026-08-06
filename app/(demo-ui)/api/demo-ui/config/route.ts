import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function GET() {
  const value = process.env.DEMO_UI_READONLY ?? process.env.NEXT_PUBLIC_DEMO_UI_READONLY;
  return NextResponse.json(
    { readonly: value === '1' },
    {
      headers: {
        'Cache-Control': 'no-store, max-age=0',
      },
    }
  );
}
