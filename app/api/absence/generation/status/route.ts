import { NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getAbsenceGenerationStatus } from '@/lib/services/absence-bank-holiday-sync';

export async function GET() {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const status = await getAbsenceGenerationStatus(supabase);
    return NextResponse.json({ success: true, ...status });
  } catch (error) {
    console.error('Error loading absence generation status:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to load status' },
      { status: 500 }
    );
  }
}
