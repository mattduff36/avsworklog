import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getProfileWithRole } from '@/lib/utils/permissions';
import {
  bookBulkAbsence,
  listBulkAbsenceBatches,
  undoBulkAbsenceBatch,
} from '@/lib/services/absence-bank-holiday-sync';

interface BulkAbsencePayload {
  reasonId?: string;
  startDate?: string;
  endDate?: string;
  notes?: string;
  applyToAll?: boolean;
  roleIds?: string[];
  roleNames?: string[];
  employeeIds?: string[];
  confirm?: boolean;
}

async function requireManagerAdmin() {
  const supabase = await createServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { supabase, profile: null, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  const profile = await getProfileWithRole(user.id);
  if (!profile?.role?.is_manager_admin) {
    return {
      supabase,
      profile: null,
      response: NextResponse.json(
        { error: 'Forbidden: Manager or Admin access required' },
        { status: 403 }
      ),
    };
  }

  return { supabase, profile, response: null };
}

export async function GET() {
  try {
    const auth = await requireManagerAdmin();
    if (auth.response) {
      return auth.response;
    }

    const batches = await listBulkAbsenceBatches(auth.supabase);
    return NextResponse.json({ success: true, batches });
  } catch (error) {
    console.error('Error loading bulk absence batches:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to load bulk absence batches' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await requireManagerAdmin();
    if (auth.response) {
      return auth.response;
    }

    const payload = (await request.json()) as BulkAbsencePayload;
    if (!payload.reasonId) {
      return NextResponse.json({ error: 'Reason is required' }, { status: 400 });
    }
    if (!payload.startDate) {
      return NextResponse.json({ error: 'Start date is required' }, { status: 400 });
    }

    const result = await bookBulkAbsence({
      supabase: auth.supabase,
      actorProfileId: auth.profile.id,
      reasonId: payload.reasonId,
      startDate: payload.startDate,
      endDate: payload.endDate,
      notes: payload.notes,
      applyToAll: payload.applyToAll !== false,
      roleIds: payload.roleIds || [],
      roleNames: payload.roleNames || [],
      employeeIds: payload.employeeIds || [],
      confirm: payload.confirm === true,
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (error) {
    console.error('Error booking bulk absence:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to book bulk absence' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await requireManagerAdmin();
    if (auth.response) {
      return auth.response;
    }

    const payload = (await request.json()) as { batchId?: string };
    if (!payload.batchId) {
      return NextResponse.json({ error: 'Batch id is required' }, { status: 400 });
    }

    const result = await undoBulkAbsenceBatch(auth.supabase, payload.batchId);
    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    console.error('Error undoing bulk absence batch:', error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : 'Failed to undo bulk absence batch' },
      { status: 500 }
    );
  }
}
