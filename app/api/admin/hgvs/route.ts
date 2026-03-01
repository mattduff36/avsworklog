import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import type { SupabaseClient } from '@supabase/supabase-js';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { logServerError } from '@/lib/utils/server-error-logger';
import { validateRegistrationNumber, formatRegistrationForStorage } from '@/lib/utils/registration';
import { createDVLAApiService } from '@/lib/services/dvla-api';
import { createMotHistoryService } from '@/lib/services/mot-history-api';
import { isRoadEligibleRegistration, runFleetDvlaSync } from '@/lib/services/fleet-dvla-sync';
import type { Database } from '@/types/database';

// GET - List all HGVs with category info
export async function GET(request: NextRequest) {
  try {
    const effectiveRole = await getEffectiveRole();

    if (!effectiveRole.user_id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!effectiveRole.is_manager_admin) {
      return NextResponse.json(
        { error: 'Forbidden: Manager or Admin access required' },
        { status: 403 }
      );
    }

    const supabase = await createServerClient();

    const { data: hgvs, error } = await supabase
      .from('hgvs')
      .select(`
        *,
        hgv_categories (
          id,
          name
        )
      `)
      .order('reg_number');

    if (error) throw error;

    return NextResponse.json({ hgvs: hgvs || [] });
  } catch (error) {
    console.error('Error fetching HGVs:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/hgvs',
      additionalData: {
        endpoint: '/api/admin/hgvs',
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST - Create a new HGV
export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const {
      reg_number,
      category_id,
      nickname,
      status = 'active',
    } = body;

    if (!category_id) {
      return NextResponse.json(
        { error: 'Category is required' },
        { status: 400 }
      );
    }

    if (!reg_number) {
      return NextResponse.json(
        { error: 'Registration number is required' },
        { status: 400 }
      );
    }

    const validationError = validateRegistrationNumber(reg_number);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const cleanReg = formatRegistrationForStorage(reg_number);

    const { data, error } = await supabase
      .from('hgvs')
      .insert({
        reg_number: cleanReg,
        category_id: category_id,
        status: status,
        nickname: nickname?.trim() || null,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'HGV with this registration already exists' },
          { status: 400 }
        );
      }
      throw error;
    }

    console.log(`[INFO] HGV created: ${data.reg_number} (ID: ${data.id})`);

    const syncResult = await syncHgvData(data.id, data.reg_number, user.id, supabase);

    return NextResponse.json({
      hgv: data,
      syncResult,
      message: syncResult.success
        ? 'HGV created and data synced successfully'
        : 'HGV created. Note: ' + (syncResult.warning || 'API sync will retry automatically'),
    });
  } catch (error) {
    console.error('Error creating HGV:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/hgvs',
      additionalData: {
        endpoint: '/api/admin/hgvs',
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

async function syncHgvData(
  hgvId: string,
  regNumber: string,
  userId: string,
  supabase: SupabaseClient<Database>
) {
  if (!isRoadEligibleRegistration(regNumber)) {
    return {
      success: true,
      skipped: true,
      reason: 'not road-eligible',
    };
  }

  const dvlaService = createDVLAApiService();
  if (!dvlaService) {
    return {
      success: false,
      warning: 'DVLA API not configured',
    };
  }

  const motService = createMotHistoryService();

  try {
    const summary = await runFleetDvlaSync({
      supabase,
      dvlaService,
      motService,
      targets: [
        {
          assetType: 'hgv',
          assetId: hgvId,
          registrationNumber: regNumber,
        },
      ],
      triggerType: 'auto_on_create',
      triggeredBy: userId,
    });

    const row = summary.results[0];
    if (!row || !row.success) {
      throw new Error(row?.error || row?.errors?.[0] || 'Unknown HGV auto-sync error');
    }

    return {
      success: true,
      fieldsUpdated: row.updatedFields || [],
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown HGV auto-sync error';
    await logServerError({
      error: error as Error,
      componentName: 'syncHgvData',
      additionalData: {
        hgvId,
        regNumber,
        context: 'auto_sync_on_hgv_create',
      },
    });

    return {
      success: false,
      error: message,
      warning: 'Could not fetch HGV data from DVLA/MOT APIs. Please check the registration number or try manual sync later.',
    };
  }
}
