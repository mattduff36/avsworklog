import { NextRequest, NextResponse } from 'next/server';
import { requireDebugConsoleAccess } from '@/lib/server/debug-console-access';
import { InventoryKioskDeviceError } from '@/lib/server/inventory-kiosk-devices';
import { getInventoryKioskDebugSnapshot } from '@/lib/server/inventory-kiosk-remote';

export async function GET(request: NextRequest) {
  const access = await requireDebugConsoleAccess();
  if (!access.ok) {
    return NextResponse.json(
      { error: access.error || 'Forbidden' },
      { status: access.status },
    );
  }

  try {
    const diagnosticId = request.nextUrl.searchParams.get('diagnostic_id');
    const snapshot = await getInventoryKioskDebugSnapshot({
      diagnosticId,
    });
    return NextResponse.json({ success: true, ...snapshot });
  } catch (error) {
    const status = error instanceof InventoryKioskDeviceError ? error.status : 500;
    return NextResponse.json(
      {
        error: error instanceof Error
          ? error.message
          : 'Unable to load Yard kiosk diagnostics',
      },
      { status },
    );
  }
}
