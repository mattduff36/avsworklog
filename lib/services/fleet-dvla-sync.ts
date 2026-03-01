import { formatRegistrationForApi } from '@/lib/utils/registration';
import type { DVLAApiService } from '@/lib/services/dvla-api';
import type { MotHistoryService } from '@/lib/services/mot-history-api';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/types/database';

export type FleetAssetType = 'van' | 'hgv' | 'plant';
type MaintenanceForeignKey = 'van_id' | 'hgv_id' | 'plant_id';

export interface FleetSyncTarget {
  assetType: FleetAssetType;
  assetId: string;
  registrationNumber: string;
}

export interface FleetSyncOptions {
  supabase: SupabaseClient<Database>;
  dvlaService: DVLAApiService;
  motService: MotHistoryService | null;
  targets: FleetSyncTarget[];
  triggerType: 'manual' | 'bulk' | 'automatic' | 'auto_on_create';
  triggeredBy: string | null;
  logPrefix?: string;
  delayMsBetweenRequests?: number;
}

export interface FleetSyncResultRow {
  success: boolean;
  assetType: FleetAssetType;
  assetId: string;
  vehicleId: string;
  registrationNumber: string;
  updatedFields?: string[];
  fields_updated?: string[];
  errors?: string[];
  error?: string;
  syncedAt: string;
}

export interface FleetSyncSummary {
  total: number;
  successful: number;
  failed: number;
  results: FleetSyncResultRow[];
}

export const TEST_REGISTRATIONS = new Set(['TE57VAN', 'TE57HGV']);

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Unknown sync error';
}

function fkForAssetType(assetType: FleetAssetType): MaintenanceForeignKey {
  if (assetType === 'hgv') return 'hgv_id';
  if (assetType === 'plant') return 'plant_id';
  return 'van_id';
}

export function isRoadEligibleRegistration(registrationNumber?: string | null): boolean {
  if (!registrationNumber) return false;
  const normalized = registrationNumber.replace(/\s+/g, '').toUpperCase();
  if (!normalized) return false;
  return !TEST_REGISTRATIONS.has(normalized);
}

function toIsoDate(value: Date): string {
  return value.toISOString().split('T')[0];
}

export async function runFleetDvlaSync(options: FleetSyncOptions): Promise<FleetSyncSummary> {
  const {
    supabase,
    dvlaService,
    motService,
    targets,
    triggerType,
    triggeredBy,
    logPrefix = '',
    delayMsBetweenRequests = 0,
  } = options;

  const results: FleetSyncResultRow[] = [];
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < targets.length; i++) {
    const target = targets[i];
    const startTime = Date.now();
    const fkField = fkForAssetType(target.assetType);
    const regNumberNoSpaces = formatRegistrationForApi(target.registrationNumber);
    const syncTime = new Date().toISOString();

    try {
      const dvlaData = await dvlaService.getVehicleData(regNumberNoSpaces);
      const dvlaResponseTime = Date.now() - startTime;
      console.log(`${logPrefix}[SYNC] Fetched DVLA for ${target.registrationNumber}`);

      let motExpiryData: Awaited<ReturnType<MotHistoryService['getMotExpiryData']>> | null = null;
      let motApiError: string | null = null;
      if (motService) {
        try {
          motExpiryData = await motService.getMotExpiryData(regNumberNoSpaces);
        } catch (motError: unknown) {
          motApiError = getErrorMessage(motError);
          console.error(`${logPrefix}[SYNC] MOT fetch failed for ${target.registrationNumber}:`, motApiError);
        }
      }

      const { data: existingRecord } = await supabase
        .from('vehicle_maintenance')
        .select('tax_due_date, mot_due_date')
        .eq(fkField, target.assetId)
        .single();

      const oldTaxDate = existingRecord?.tax_due_date || null;
      const oldMotDate = existingRecord?.mot_due_date || null;

      const updates: Record<string, unknown> = {
        dvla_sync_status: 'success',
        last_dvla_sync: syncTime,
        dvla_sync_error: null,
        dvla_raw_data: dvlaData.rawData || null,
        ves_make: dvlaData.make || null,
        ves_colour: dvlaData.colour || null,
        ves_fuel_type: dvlaData.fuelType || null,
        ves_year_of_manufacture: dvlaData.yearOfManufacture || null,
        ves_engine_capacity: dvlaData.engineSize || null,
        ves_tax_status: dvlaData.taxStatus || null,
        ves_mot_status: dvlaData.motStatus || null,
        ves_co2_emissions: dvlaData.co2Emissions || null,
        ves_euro_status: dvlaData.euroStatus || null,
        ves_real_driving_emissions: dvlaData.realDrivingEmissions || null,
        ves_type_approval: dvlaData.typeApproval || null,
        ves_wheelplan: dvlaData.wheelplan || null,
        ves_revenue_weight: dvlaData.revenueWeight || null,
        ves_marked_for_export: dvlaData.markedForExport || false,
        ves_month_of_first_registration: dvlaData.monthOfFirstRegistration || null,
        ves_date_of_last_v5c_issued: dvlaData.dateOfLastV5CIssued || null,
      };

      const fieldsUpdated: string[] = [];

      if (dvlaData.taxDueDate) {
        updates.tax_due_date = dvlaData.taxDueDate;
        if (oldTaxDate !== dvlaData.taxDueDate) fieldsUpdated.push('tax_due_date');
      }

      if (motService) {
        if (motApiError) {
          updates.mot_api_sync_status = 'error';
          updates.last_mot_api_sync = syncTime;
          updates.mot_api_sync_error = motApiError;

          // Keep first MOT fallback behavior for newer assets.
          if (motApiError.includes('No MOT history found') && dvlaData.monthOfFirstRegistration) {
            try {
              const [year, month] = dvlaData.monthOfFirstRegistration.split('.');
              if (year && month) {
                const firstRegDate = new Date(parseInt(year, 10), parseInt(month, 10) - 1, 1);
                const firstMotDue = new Date(firstRegDate);
                firstMotDue.setFullYear(firstMotDue.getFullYear() + 3);
                const calculatedMotDue = toIsoDate(firstMotDue);
                updates.mot_due_date = calculatedMotDue;
                updates.mot_expiry_date = calculatedMotDue;
                updates.mot_first_used_date = toIsoDate(firstRegDate);
                if (oldMotDate !== calculatedMotDue) {
                  fieldsUpdated.push('mot_due_date (calculated from DVLA)');
                }
              }
            } catch (error) {
              console.error(`${logPrefix}[SYNC] Failed MOT fallback calculation`, error);
            }
          }
        } else if (motExpiryData?.motExpiryDate || motExpiryData?.rawData) {
          const motRawData = motExpiryData.rawData;
          if (motRawData) {
            updates.mot_make = motRawData.make || null;
            updates.mot_model = motRawData.model || null;
            updates.mot_fuel_type = motRawData.fuelType || null;
            updates.mot_primary_colour = motRawData.primaryColour || null;
            updates.mot_registration = motRawData.registration || null;
            if (motRawData.manufactureYear) {
              updates.mot_year_of_manufacture = parseInt(motRawData.manufactureYear, 10);
            }
            if (motRawData.firstUsedDate) {
              updates.mot_first_used_date = motRawData.firstUsedDate;
            }
          }

          if (motExpiryData.motExpiryDate) {
            updates.mot_due_date = motExpiryData.motExpiryDate;
            updates.mot_expiry_date = motExpiryData.motExpiryDate;
            if (oldMotDate !== motExpiryData.motExpiryDate) fieldsUpdated.push('mot_due_date');
          } else if (motRawData?.firstUsedDate) {
            const firstUsedDate = new Date(motRawData.firstUsedDate);
            const firstMotDue = new Date(firstUsedDate);
            firstMotDue.setFullYear(firstMotDue.getFullYear() + 3);
            const calculatedMotDue = toIsoDate(firstMotDue);
            updates.mot_due_date = calculatedMotDue;
            updates.mot_expiry_date = calculatedMotDue;
            if (oldMotDate !== calculatedMotDue) fieldsUpdated.push('mot_due_date (calculated)');
          }

          updates.mot_api_sync_status = 'success';
          updates.last_mot_api_sync = syncTime;
          updates.mot_api_sync_error = null;
          updates.mot_raw_data = motRawData || null;
        } else {
          updates.mot_api_sync_status = 'success';
          updates.last_mot_api_sync = syncTime;
          updates.mot_api_sync_error = 'No MOT history found';
          updates.mot_raw_data = motExpiryData?.rawData || null;
        }
      }

      const { error: upsertError } = await supabase
        .from('vehicle_maintenance')
        .upsert(
          {
            [fkField]: target.assetId,
            ...updates,
            updated_at: syncTime,
          },
          { onConflict: fkField }
        );
      if (upsertError) throw upsertError;

      const persistedMotDate = updates.mot_due_date || null;
      await supabase.from('dvla_sync_log').insert({
        [fkField]: target.assetId,
        registration_number: target.registrationNumber,
        sync_status: 'success',
        fields_updated: fieldsUpdated,
        tax_due_date_old: oldTaxDate,
        tax_due_date_new: dvlaData.taxDueDate,
        mot_due_date_old: oldMotDate,
        mot_due_date_new: persistedMotDate,
        api_provider: `${process.env.DVLA_API_PROVIDER}${motService ? '+MOT' : ''}`,
        api_response_time_ms: dvlaResponseTime,
        raw_response: {
          dvla: dvlaData.rawData,
          mot: motExpiryData?.rawData || null,
        },
        triggered_by: triggeredBy,
        trigger_type: triggerType,
      });

      let updaterName = triggerType === 'automatic' ? 'Scheduled DVLA Sync' : 'DVLA API Sync';
      if (triggeredBy) {
        const { data: userProfile } = await supabase
          .from('profiles')
          .select('full_name')
          .eq('id', triggeredBy)
          .single();
        if (userProfile?.full_name) {
          updaterName = `${userProfile.full_name} (via DVLA Sync)`;
        }
      }

      const historyEntries: Array<Record<string, unknown>> = [];
      if (dvlaData.taxDueDate && oldTaxDate !== dvlaData.taxDueDate) {
        historyEntries.push({
          [fkField]: target.assetId,
          field_name: 'tax_due_date',
          old_value: oldTaxDate,
          new_value: dvlaData.taxDueDate,
          value_type: 'date',
          comment:
            triggerType === 'automatic'
              ? `Tax due date updated automatically via scheduled DVLA API sync for ${target.registrationNumber}`
              : `Tax due date updated automatically via DVLA API sync for ${target.registrationNumber}`,
          updated_by: triggeredBy,
          updated_by_name: updaterName,
        });
      }

      if (persistedMotDate && oldMotDate !== persistedMotDate) {
        const wasCalculated = fieldsUpdated.some((f) => f.includes('calculated'));
        historyEntries.push({
          [fkField]: target.assetId,
          field_name: 'mot_due_date',
          old_value: oldMotDate,
          new_value: persistedMotDate,
          value_type: 'date',
          comment: wasCalculated
            ? `MOT due date calculated from first registration via DVLA API sync for ${target.registrationNumber}`
            : `MOT due date updated automatically via DVLA/MOT API sync for ${target.registrationNumber}`,
          updated_by: triggeredBy,
          updated_by_name: updaterName,
        });
      }

      if (historyEntries.length > 0) {
        const { error: historyError } = await supabase
          .from('maintenance_history')
          .insert(historyEntries);
        if (historyError) {
          console.error(`${logPrefix}[SYNC] Failed to write maintenance history`, historyError);
        }
      }

      results.push({
        success: true,
        assetType: target.assetType,
        assetId: target.assetId,
        vehicleId: target.assetId,
        registrationNumber: target.registrationNumber,
        updatedFields: fieldsUpdated,
        fields_updated: fieldsUpdated,
        syncedAt: syncTime,
      });
      successCount++;
    } catch (error: unknown) {
      const errorMessage = getErrorMessage(error);
      console.error(`${logPrefix}[SYNC] Failed ${target.registrationNumber}:`, errorMessage);

      await supabase.from('vehicle_maintenance').upsert(
        {
          [fkField]: target.assetId,
          dvla_sync_status: 'error',
          dvla_sync_error: errorMessage,
          last_dvla_sync: syncTime,
          updated_at: syncTime,
        },
        { onConflict: fkField }
      );

      await supabase.from('dvla_sync_log').insert({
        [fkField]: target.assetId,
        registration_number: target.registrationNumber,
        sync_status: 'error',
        error_message: errorMessage,
        api_provider: process.env.DVLA_API_PROVIDER,
        triggered_by: triggeredBy,
        trigger_type: triggerType,
      });

      results.push({
        success: false,
        assetType: target.assetType,
        assetId: target.assetId,
        vehicleId: target.assetId,
        registrationNumber: target.registrationNumber,
        errors: [errorMessage],
        error: errorMessage,
        syncedAt: syncTime,
      });
      failCount++;
    }

    if (delayMsBetweenRequests > 0 && i < targets.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, delayMsBetweenRequests));
    }
  }

  return {
    total: targets.length,
    successful: successCount,
    failed: failCount,
    results,
  };
}
