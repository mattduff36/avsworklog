import { NextRequest, NextResponse } from 'next/server';
import {
  getYardKioskBootstrap,
  InventoryKioskError,
  requireInventoryKioskAccess,
  toInventoryKioskErrorResponse,
} from '@/lib/server/inventory-kiosk';

export async function GET(request?: NextRequest) {
  try {
    const access = await requireInventoryKioskAccess();
    if (!access.allowed) {
      return NextResponse.json(
        { error: access.error, configured: access.status !== 503 },
        { status: access.status },
      );
    }

    return NextResponse.json(await getYardKioskBootstrap(access, {
      includeLegacyQuotes: request?.nextUrl.searchParams.get('includeLegacyQuotes') === 'true',
    }));
  } catch (error) {
    if (error instanceof InventoryKioskError) {
      const response = toInventoryKioskErrorResponse(error);
      return NextResponse.json(response.body, { status: response.status });
    }
    console.error('Error loading Yard kiosk bootstrap:', error);
    return NextResponse.json({ error: 'Failed to load the Yard kiosk' }, { status: 500 });
  }
}
