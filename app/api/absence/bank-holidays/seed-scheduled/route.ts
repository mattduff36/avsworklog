import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { timingSafeEqual } from 'crypto';
import { seedFinancialYearBankHolidays } from '@/lib/services/absence-bank-holiday-sync';
import type { Database } from '@/types/database';

export const dynamic = 'force-dynamic';

function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error('Supabase service role credentials are not configured');
  }

  return createClient<Database>(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

function isAuthorizedCronRequest(authHeader: string | null, cronSecret: string): boolean {
  if (!authHeader?.startsWith('Bearer ')) return false;
  const providedToken = authHeader.slice('Bearer '.length);

  const providedBuffer = Buffer.from(providedToken, 'utf8');
  const secretBuffer = Buffer.from(cronSecret, 'utf8');
  if (providedBuffer.length !== secretBuffer.length) return false;

  return timingSafeEqual(providedBuffer, secretBuffer);
}

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;

    if (!cronSecret) {
      console.error('CRON_SECRET is not configured for bank holiday scheduled seed endpoint');
      return NextResponse.json({ error: 'Server configuration error' }, { status: 500 });
    }

    if (!isAuthorizedCronRequest(authHeader, cronSecret)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = createServiceClient();
    const result = await seedFinancialYearBankHolidays({ supabase });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('Error in scheduled bank holiday seed:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed scheduled bank holiday seed',
      },
      { status: 500 }
    );
  }
}
