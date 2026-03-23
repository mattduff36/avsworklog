import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getAbsenceAnnouncement, saveAbsenceAnnouncement } from '@/lib/server/absence-module-settings';
import { requireAbsenceUser, requireAdminAbsenceAccess } from '@/lib/server/absence-work-shift-auth';

interface UpdateAbsenceMessageBody {
  message?: string | null;
}

export async function GET() {
  try {
    const auth = await requireAbsenceUser();
    if (auth.response) {
      return auth.response;
    }

    const announcement = await getAbsenceAnnouncement(createAdminClient());
    return NextResponse.json({
      success: true,
      message: announcement.message,
      updatedAt: announcement.updatedAt,
    });
  } catch (error) {
    console.error('Error loading absence announcement:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to load absence announcement' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const auth = await requireAdminAbsenceAccess();
    if (auth.response) {
      return auth.response;
    }

    const body = (await request.json()) as UpdateAbsenceMessageBody;
    if (!('message' in body) || (body.message !== null && typeof body.message !== 'string')) {
      return NextResponse.json({ error: 'A string or null message is required' }, { status: 400 });
    }

    const announcement = await saveAbsenceAnnouncement(createAdminClient(), body.message);
    return NextResponse.json({
      success: true,
      message: announcement.message,
      updatedAt: announcement.updatedAt,
    });
  } catch (error) {
    console.error('Error saving absence announcement:', error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to save absence announcement' },
      { status: 500 }
    );
  }
}
