import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  url.pathname = url.pathname.replace('/api/admin/vehicles', '/api/admin/vans');
  return NextResponse.redirect(url, 308);
}

export async function POST(request: NextRequest) {
  const url = new URL(request.url);
  url.pathname = url.pathname.replace('/api/admin/vehicles', '/api/admin/vans');
  return NextResponse.redirect(url, 308);
}
