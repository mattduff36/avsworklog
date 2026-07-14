import { NextRequest, NextResponse } from 'next/server';
import type { YardKioskDirection } from '@/lib/inventory/kiosk-types';
import {
  getYardKioskStock,
  InventoryKioskError,
  requireInventoryKioskAccess,
  toInventoryKioskErrorResponse,
} from '@/lib/server/inventory-kiosk';

export async function GET(request: NextRequest) {
  try {
    const access = await requireInventoryKioskAccess();
    if (!access.allowed) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const direction = request.nextUrl.searchParams.get('direction') as YardKioskDirection;
    const counterpartId = request.nextUrl.searchParams.get('counterpart_location_id') || '';
    return NextResponse.json(await getYardKioskStock(access, direction, counterpartId));
  } catch (error) {
    if (error instanceof InventoryKioskError) {
      const response = toInventoryKioskErrorResponse(error);
      return NextResponse.json(response.body, { status: response.status });
    }
    console.error('Error loading Yard kiosk stock:', error);
    return NextResponse.json({ error: 'Failed to load stock for this transfer' }, { status: 500 });
  }
}
