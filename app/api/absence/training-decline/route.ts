import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logServerError } from '@/lib/utils/server-error-logger';
import { declineTrainingBookings } from '@/lib/server/training-bookings';

interface TrainingDeclineRequestBody {
  absenceIds?: string[];
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = (await request.json()) as TrainingDeclineRequestBody;
    const absenceIds = Array.isArray(body.absenceIds)
      ? body.absenceIds.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      : [];

    if (absenceIds.length === 0) {
      return NextResponse.json({ error: 'At least one training booking is required' }, { status: 400 });
    }

    const result = await declineTrainingBookings(user.id, absenceIds);

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Internal server error';
    const status =
      /permission|unauthorized|forbidden/i.test(message) ? 403 :
      /not found|required|must belong|only training|processed|adjusted/i.test(message) ? 400 :
      500;

    console.error('Error declining training booking:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/absence/training-decline',
      additionalData: {
        endpoint: '/api/absence/training-decline',
      },
    });

    return NextResponse.json({ error: message }, { status });
  }
}
