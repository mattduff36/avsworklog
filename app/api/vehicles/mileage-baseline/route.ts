import { NextRequest, NextResponse } from 'next/server';

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  url.pathname = url.pathname.replace('/api/vehicles/mileage-baseline', '/api/vans/mileage-baseline');
  return NextResponse.redirect(url, 308);
}
