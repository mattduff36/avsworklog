import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createDVLAApiService } from '@/lib/services/dvla-api';
import { createMotHistoryService } from '@/lib/services/mot-history-api';
import { logServerError } from '@/lib/utils/server-error-logger';
import {
  isRoadEligibleRegistration,
  runFleetDvlaSync,
  type FleetAssetType,
  type FleetSyncTarget,
} from '@/lib/services/fleet-dvla-sync';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

export const dynamic = 'force-dynamic';
export const maxDuration = 300; // 5 minutes max execution time

function mapTableToAssetType(tableName: 'vans' | 'hgvs' | 'plant'): FleetAssetType {
  if (tableName === 'hgvs') return 'hgv';
  if (tableName === 'plant') return 'plant';
  return 'van';
}

async function loadActiveTargets(
  supabase: SupabaseClient<Database>,
  tableName: 'vans' | 'hgvs' | 'plant'
): Promise<FleetSyncTarget[]> {
  const { data, error } = await supabase
    .from(tableName)
    .select('id, reg_number')
    .eq('status', 'active');
  if (error) throw error;

  return (data || [])
    .map((row: { id: string; reg_number: string }) => ({
      assetType: mapTableToAssetType(tableName),
      assetId: row.id,
      registrationNumber: row.reg_number,
    }))
    .filter((target) => isRoadEligibleRegistration(target.registrationNumber));
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Internal server error';
}

export async function POST(request: NextRequest) {
  try {
    // Verify cron secret for security
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    
    if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        { success: false, error: 'Unauthorized' },
        { status: 401 }
      );
    }

    const supabase = await createClient();

    // Check if DVLA API is configured
    const dvlaService = createDVLAApiService();
    if (!dvlaService) {
      console.log('DVLA API not configured - skipping scheduled sync');
      return NextResponse.json({
        success: true,
        message: 'DVLA API not configured',
        total: 0,
        successful: 0,
        failed: 0,
        skipped: 0,
      });
    }

    // Check if MOT API is configured (optional, sync will continue if not available)
    const motService = createMotHistoryService();

    const [vanTargets, hgvTargets, plantTargets] = await Promise.all([
      loadActiveTargets(supabase, 'vans'),
      loadActiveTargets(supabase, 'hgvs'),
      loadActiveTargets(supabase, 'plant'),
    ]);
    const allTargets = [...vanTargets, ...hgvTargets, ...plantTargets];

    if (allTargets.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No active road-eligible assets to sync',
        total: 0,
        successful: 0,
        failed: 0,
        skipped: 0,
      });
    }

    const { data: maintenanceRecords } = await supabase.from('vehicle_maintenance').select(
      'van_id, hgv_id, plant_id, last_dvla_sync'
    );
    const maintenanceMap = new Map<string, string | null>();
    for (const row of maintenanceRecords || []) {
      if (row.van_id) maintenanceMap.set(`van:${row.van_id}`, row.last_dvla_sync);
      if (row.hgv_id) maintenanceMap.set(`hgv:${row.hgv_id}`, row.last_dvla_sync);
      if (row.plant_id) maintenanceMap.set(`plant:${row.plant_id}`, row.last_dvla_sync);
    }

    // Filter assets that need syncing (not synced in the last 23 hours)
    const twentyThreeHoursAgo = new Date(Date.now() - 23 * 60 * 60 * 1000);

    const targetsToSync = allTargets.filter((target) => {
      const lastSync = maintenanceMap.get(`${target.assetType}:${target.assetId}`);
      if (!lastSync) return true; // Never synced
      return new Date(lastSync) < twentyThreeHoursAgo; // Synced more than 23 hours ago
    });

    console.log(`Scheduled sync: ${targetsToSync.length}/${allTargets.length} assets need syncing`);

    if (targetsToSync.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'All road-eligible assets recently synced',
        total: allTargets.length,
        successful: 0,
        failed: 0,
        skipped: allTargets.length,
      });
    }

    const summary = await runFleetDvlaSync({
      supabase,
      dvlaService,
      motService,
      targets: targetsToSync,
      triggerType: 'automatic',
      triggeredBy: null,
      logPrefix: '[CRON] ',
      delayMsBetweenRequests: 1000,
    });

    console.log(`Scheduled sync complete: ${summary.successful} successful, ${summary.failed} failed`);

    return NextResponse.json({
      success: true,
      total: allTargets.length,
      synced: targetsToSync.length,
      successful: summary.successful,
      failed: summary.failed,
      skipped: allTargets.length - targetsToSync.length,
      results: summary.results,
    });

  } catch (error: unknown) {
    await logServerError(error, {
      endpoint: '/api/maintenance/sync-dvla-scheduled',
      method: 'POST',
    });

    return NextResponse.json(
      { success: false, error: getErrorMessage(error) },
      { status: 500 }
    );
  }
}

