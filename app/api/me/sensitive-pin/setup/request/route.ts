import { NextRequest, NextResponse } from 'next/server';
import { requestSensitivePinVerification } from '@/lib/server/sensitive-pin';

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => null)) as { pin?: string } | null;
    const result = await requestSensitivePinVerification({
      pin: typeof body?.pin === 'string' ? body.pin : '',
      purpose: 'setup',
    });

    return NextResponse.json({ success: true, email: result.email });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to request PIN setup verification';
    return NextResponse.json(
      { error: message },
      { status: message === 'Unauthorized' ? 401 : 400 }
    );
  }
}
