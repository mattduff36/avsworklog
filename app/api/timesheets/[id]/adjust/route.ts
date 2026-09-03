import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  TIMESHEET_ADJUST_RETIRED_CODE,
  TIMESHEET_ADJUST_RETIRED_MESSAGE,
} from '@/lib/utils/timesheet-gates';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  await params;
  const supabase = await createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return NextResponse.json(
    {
      error: TIMESHEET_ADJUST_RETIRED_MESSAGE,
      code: TIMESHEET_ADJUST_RETIRED_CODE,
    },
    { status: 409 }
  );
}
