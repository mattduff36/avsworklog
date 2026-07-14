import { NextRequest, NextResponse } from 'next/server';
import {
  InventoryKioskError,
  requireInventoryKioskAccess,
  submitYardKioskBasket,
  toInventoryKioskErrorResponse,
} from '@/lib/server/inventory-kiosk';

export async function POST(request: NextRequest) {
  try {
    const access = await requireInventoryKioskAccess();
    if (!access.allowed) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const payload = await request.json();
    return NextResponse.json(await submitYardKioskBasket(access, payload));
  } catch (error) {
    if (error instanceof InventoryKioskError) {
      const response = toInventoryKioskErrorResponse(error);
      return NextResponse.json(response.body, { status: response.status });
    }
    console.error('Error submitting Yard kiosk basket:', error);
    return NextResponse.json({ error: 'Failed to transfer the Yard kiosk basket' }, { status: 500 });
  }
}
