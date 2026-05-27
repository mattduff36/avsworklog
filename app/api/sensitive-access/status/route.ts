import { NextRequest, NextResponse } from 'next/server';
import { ALL_MODULES, type ModuleName } from '@/types/roles';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { getSensitiveModulePinState } from '@/lib/server/sensitive-pin';

export async function GET(request: NextRequest) {
  try {
    const moduleName = new URL(request.url).searchParams.get('module');
    if (!moduleName || !ALL_MODULES.includes(moduleName as ModuleName)) {
      return NextResponse.json({ error: 'Unknown module' }, { status: 400 });
    }

    const canAccess = await canEffectiveRoleAccessModule(moduleName as ModuleName);
    if (!canAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const state = await getSensitiveModulePinState(moduleName as ModuleName);
    return NextResponse.json({ success: true, state });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to load sensitive access status';
    return NextResponse.json(
      { error: message },
      { status: message === 'Unauthorized' ? 401 : 500 }
    );
  }
}
