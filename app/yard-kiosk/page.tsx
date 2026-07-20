import { redirect } from 'next/navigation';
import {
  getYardKioskBootstrap,
  requireInventoryKioskAccess,
} from '@/lib/server/inventory-kiosk';
import {
  buildYardKioskUserError,
  createYardKioskDiagnosticId,
} from '@/lib/inventory/kiosk-errors';
import { YardKioskApp } from './components/YardKioskApp';
import { YardKioskRecoveryScreen } from './components/YardKioskRecoveryScreen';

export const dynamic = 'force-dynamic';

export default async function YardKioskPage() {
  const access = await requireInventoryKioskAccess();
  if (!access.allowed && access.status === 401) {
    redirect('/yard-kiosk/activate');
  }

  if (!access.allowed) {
    const code = access.status === 403
      ? 'WRONG_PROFILE'
      : (access.error || '').toLowerCase().includes('yard')
        ? 'YARD_MISSING'
        : 'KIOSK_DISABLED';
    return (
      <YardKioskRecoveryScreen
        error={buildYardKioskUserError(code, {
          diagnosticId: createYardKioskDiagnosticId(),
          technicalDetail: access.error || undefined,
        })}
      />
    );
  }

  let bootstrap: Awaited<ReturnType<typeof getYardKioskBootstrap>> | null = null;
  try {
    bootstrap = await getYardKioskBootstrap(access);
  } catch (error) {
    console.error('Error rendering Yard kiosk:', error);
  }

  if (!bootstrap) {
    return (
      <YardKioskRecoveryScreen
        error={buildYardKioskUserError('SERVICE_UNAVAILABLE', {
          diagnosticId: createYardKioskDiagnosticId(),
          whatHappened: 'Live Inventory data could not be loaded for Yard Inventory.',
        })}
      />
    );
  }

  return <YardKioskApp bootstrap={bootstrap} />;
}
