import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { listQuoteManagerOptions } from '@/lib/server/quote-workflow';

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'You must be signed in to use quotes.' }, { status: 401 });
    }

    const [managerOptions, approversResult] = await Promise.all([
      listQuoteManagerOptions(),
      createAdminClient()
        .from('profiles')
        .select('id, full_name')
        .order('full_name'),
    ]);

    if (approversResult.error) {
      throw approversResult.error;
    }

    return NextResponse.json({
      managerOptions,
      approvers: (approversResult.data || []).map(approver => ({
        ...approver,
        email: null,
      })),
    });
  } catch (error) {
    console.error('Error fetching quote metadata:', error);
    return NextResponse.json({ error: 'Unable to load quote settings right now.' }, { status: 500 });
  }
}
