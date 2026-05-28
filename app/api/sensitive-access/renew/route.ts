import { NextRequest, NextResponse } from 'next/server';
import { ALL_MODULES, type ModuleName } from '@/types/roles';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';
import { renewSensitiveModuleAccess } from '@/lib/server/sensitive-pin';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as {
      module?: string;
    } | null;
    const moduleName = body?.module;
    if (!moduleName || !ALL_MODULES.includes(moduleName as ModuleName)) {
      return NextResponse.json({ error: 'Unknown module' }, { status: 400 });
    }

    const canAccess = await canEffectiveRoleAccessModule(moduleName as ModuleName);
    if (!canAccess) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const state = await renewSensitiveModuleAccess(moduleName as ModuleName);
    return NextResponse.json({ success: true, state });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to renew sensitive module access';
    const status = message === 'Unauthorized'
      ? 401
      : message === 'Sensitive access PIN required for protected modules.'
        ? 428
        : 400;

    return NextResponse.json(
      {
        error: message,
        code: status === 428 ? 'SENSITIVE_PIN_REQUIRED' : undefined,
      },
      { status }
    );
  }
}
