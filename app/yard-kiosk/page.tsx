import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import {
  requireInventoryKioskAccess,
} from '@/lib/server/inventory-kiosk';
import { validateAppSession } from '@/lib/server/app-auth/session';
import {
  buildYardKioskUserError,
  createYardKioskDiagnosticId,
} from '@/lib/inventory/kiosk-errors';
import { YardKioskBootstrapLoader } from './components/YardKioskBootstrapLoader';
import { YardKioskRecoveryScreen } from './components/YardKioskRecoveryScreen';

export const dynamic = 'force-dynamic';

export default async function YardKioskPage() {
  // Detect secret rotation / inactive session before other access work so a
  // rotated DB secret is never left without a browser cookie write-back.
  const session = await validateAppSession({ allowKioskDevice: true });
  if (session.status !== 'active' || session.secretRotated) {
    const userAgent = (await headers()).get('user-agent') || '';
    redirect(
      userAgent.includes('AVSYardKiosk/')
        ? '/yard-kiosk/native'
        : '/yard-kiosk/activate',
    );
  }

  const access = await requireInventoryKioskAccess(session.profileId || undefined);
  if (!access.allowed && access.status === 401) {
    const userAgent = (await headers()).get('user-agent') || '';
    redirect(
      userAgent.includes('AVSYardKiosk/')
        ? '/yard-kiosk/native'
        : '/yard-kiosk/activate',
    );
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

  return <YardKioskBootstrapLoader />;
}
