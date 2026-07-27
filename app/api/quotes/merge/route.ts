import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireSensitiveModuleAccess } from '@/lib/server/sensitive-module-access';
import { isEffectiveRoleAdminOrSuper } from '@/lib/utils/rbac';
import { mergeLiveQuotes } from '@/lib/server/quote-merge';

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return NextResponse.json({ error: 'You must be signed in to merge quotes.' }, { status: 401 });
    }

    const sensitiveAccessResponse = await requireSensitiveModuleAccess('quotes');
    if (sensitiveAccessResponse) return sensitiveAccessResponse;

    if (!await isEffectiveRoleAdminOrSuper()) {
      return NextResponse.json({ error: 'Only administrators can merge live quotes.' }, { status: 403 });
    }

    const body = await request.json() as Record<string, unknown>;
    const result = await mergeLiveQuotes(createAdminClient(), body, user.id);
    return NextResponse.json({ merge: result });
  } catch (error) {
    console.error('Error merging live quotes:', error);
    const message = error instanceof Error ? error.message : 'Unable to merge quotes right now.';
    const status = /select|choose|same|latest|open|confirm|already|administrator/i.test(message)
      ? 400
      : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
