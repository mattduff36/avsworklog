import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getEffectiveRole } from '@/lib/utils/view-as';
import { logServerError } from '@/lib/utils/server-error-logger';
import { createDVLAApiService } from '@/lib/services/dvla-api';
import { createMotHistoryService } from '@/lib/services/mot-history-api';
import { formatRegistrationForStorage, validateRegistrationNumber } from '@/lib/utils/registration';
import { isRoadEligibleRegistration, runFleetDvlaSync } from '@/lib/services/fleet-dvla-sync';
import type { Database } from '@/types/database';

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}

// GET - List all vans with category and last inspector info
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

    const { data: vehicles, error } = await supabase
      .from('vans')
      .select(`
        *,
        van_categories (
          id,
          name
        )
      `)
      .order('reg_number');

    if (error) throw error;

    // For each van, get the last inspector
    const vehiclesWithInspector = await Promise.all(
      (vehicles || []).map(async (vehicle) => {
        const { data: inspections } = await supabase
          .from('van_inspections')
          .select(`
            user_id,
            inspection_date,
            profiles!van_inspections_user_id_fkey (
              full_name
            )
          `)
          .eq('van_id', vehicle.id)
          .order('inspection_date', { ascending: false })
          .limit(1);

        const lastInspection = inspections?.[0] || null;

        return {
          ...vehicle,
          last_inspector: lastInspection?.profiles?.full_name || null,
          last_inspection_date: lastInspection?.inspection_date || null,
        };
      })
    );

    return NextResponse.json({ vehicles: vehiclesWithInspector });
  } catch (error) {
    console.error('Error fetching vans:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/vans',
      additionalData: {
        endpoint: '/api/admin/vans',
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST - Create new van
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
      status = 'active'
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
      .from('vans')
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
          { error: 'Van with this registration already exists' },
          { status: 400 }
        );
      }
      throw error;
    }

    console.log(`[INFO] Van created: ${data.reg_number} (ID: ${data.id})`);

    // Automatically sync TAX and MOT data from APIs (non-blocking)
    const syncResult = await syncVanData(data.id, data.reg_number, user.id, supabase);

    return NextResponse.json({ 
      vehicle: data,
      syncResult: syncResult,
      message: syncResult.success 
        ? 'Van created and data synced successfully'
        : 'Van created. Note: ' + (syncResult.warning || 'API sync will retry automatically')
    });
  } catch (error) {
    console.error('Error creating van:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/vans',
      additionalData: {
        endpoint: '/api/admin/vans',
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Sync van data from DVLA and MOT APIs
 * Runs automatically when a new van is added
 */
async function syncVanData(
  vanId: string, 
  regNumber: string, 
  userId: string,
  supabase: SupabaseClient<Database>
) {
  if (!isRoadEligibleRegistration(regNumber)) {
    console.log(`[INFO] Skipping API sync for test van: ${regNumber}`);
    return { 
      success: true, 
      skipped: true,
      reason: 'test vehicle' 
    };
  }

  const dvlaService = createDVLAApiService();
  if (!dvlaService) {
    console.log(`[WARN] DVLA API not configured, skipping auto-sync for ${regNumber}`);
    return { 
      success: false, 
      warning: 'DVLA API not configured' 
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
          assetType: 'van',
          assetId: vanId,
          registrationNumber: regNumber,
        },
      ],
      triggerType: 'auto_on_create',
      triggeredBy: userId,
    });

    const row = summary.results[0];
    if (!row || !row.success) {
      throw new Error(row?.error || row?.errors?.[0] || 'Unknown auto-sync error');
    }

    return {
      success: true,
      fieldsUpdated: row.updatedFields || [],
      responseTime: null,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown auto-sync error';
    console.error(`[ERROR] Auto-sync failed for ${regNumber}:`, message);

    await logServerError({
      error: error as Error,
      componentName: 'syncVanData',
      additionalData: {
        vanId,
        regNumber,
        context: 'auto_sync_on_van_create'
      },
    });

    return {
      success: false,
      error: message,
      warning: 'Could not fetch vehicle data from DVLA/MOT APIs. Please check the registration number or try manual sync later.'
    };
  }
}
