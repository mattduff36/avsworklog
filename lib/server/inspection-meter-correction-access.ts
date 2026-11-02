import { NextResponse } from 'next/server';
import { validateAppSession } from '@/lib/server/app-auth/session';
import { getEffectiveRoleForUser } from '@/lib/utils/view-as';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { canCorrectInspectionMeter, type InspectionAssetType } from '@/lib/inspections/meter-correction';

export async function requireInspectionMeterCorrectionAccess(assetType: InspectionAssetType) {
  // This API does not issue session cookies. Do not rotate a secret without
  // returning its replacement cookie; reuse this validated identity below.
  const session = await validateAppSession({ includeEmail: true, refresh: false });
  if (session.status !== 'active' || !session.profileId) {
    return { actorId: null, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  const role = await getEffectiveRoleForUser(session.profileId, session.email);
  const moduleName = assetType === 'van' ? 'inspections' : `${assetType}-inspections` as const;
  if (!canCorrectInspectionMeter(role) || !await canEffectiveRoleAccessModule(moduleName, { userId: session.profileId, email: session.email })) {
    return { actorId: null, response: NextResponse.json({ error: 'Only managers and above can correct Daily Check readings.' }, { status: 403 }) };
  }
  return { actorId: session.profileId, response: null };
}
