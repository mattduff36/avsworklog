import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/utils/logger';
import type {
  UpdateMaintenanceRequest,
  MaintenanceUpdateResponse
} from '@/types/maintenance';

/**
 * PUT /api/maintenance/[id]
 * Update vehicle maintenance record with mandatory comment
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Auth check
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    // Get user profile for name
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', user.id)
      .single();
    
    const userName = profile?.full_name || 'Unknown User';
    
    // Parse request body
    const body: UpdateMaintenanceRequest = await request.json();
    
    // Validate comment (mandatory, min 10 characters)
    if (!body.comment || body.comment.trim().length < 10) {
      return NextResponse.json(
        { error: 'Comment is required and must be at least 10 characters' },
        { status: 400 }
      );
    }
    
    // Get current maintenance record
    const { data: currentRecord, error: fetchError } = await supabase
      .from('vehicle_maintenance')
      .select('*, vehicle:vehicles(id, reg_number)')
      .eq('id', params.id)
      .single();
    
    if (fetchError || !currentRecord) {
      return NextResponse.json(
        { error: 'Maintenance record not found' },
        { status: 404 }
      );
    }
    
    // Build update object (only include provided fields)
    const updates: Record<string, any> = {
      updated_at: new Date().toISOString(),
      last_updated_by: user.id
    };
    
    // Track which fields changed for history
    const changedFields: Array<{
      field_name: string;
      old_value: string | null;
      new_value: string | null;
      value_type: 'date' | 'mileage' | 'boolean' | 'text';
    }> = [];
    
    // Check each possible update field
    if (body.tax_due_date !== undefined) {
      updates.tax_due_date = body.tax_due_date;
      if (currentRecord.tax_due_date !== body.tax_due_date) {
        changedFields.push({
          field_name: 'tax_due_date',
          old_value: currentRecord.tax_due_date,
          new_value: body.tax_due_date,
          value_type: 'date'
        });
      }
    }
    
    if (body.mot_due_date !== undefined) {
      updates.mot_due_date = body.mot_due_date;
      if (currentRecord.mot_due_date !== body.mot_due_date) {
        changedFields.push({
          field_name: 'mot_due_date',
          old_value: currentRecord.mot_due_date,
          new_value: body.mot_due_date,
          value_type: 'date'
        });
      }
    }
    
    if (body.first_aid_kit_expiry !== undefined) {
      updates.first_aid_kit_expiry = body.first_aid_kit_expiry;
      if (currentRecord.first_aid_kit_expiry !== body.first_aid_kit_expiry) {
        changedFields.push({
          field_name: 'first_aid_kit_expiry',
          old_value: currentRecord.first_aid_kit_expiry,
          new_value: body.first_aid_kit_expiry,
          value_type: 'date'
        });
      }
    }
    
    if (body.next_service_mileage !== undefined) {
      updates.next_service_mileage = body.next_service_mileage;
      if (currentRecord.next_service_mileage !== body.next_service_mileage) {
        changedFields.push({
          field_name: 'next_service_mileage',
          old_value: currentRecord.next_service_mileage?.toString() || null,
          new_value: body.next_service_mileage?.toString() || null,
          value_type: 'mileage'
        });
      }
    }
    
    if (body.last_service_mileage !== undefined) {
      updates.last_service_mileage = body.last_service_mileage;
      if (currentRecord.last_service_mileage !== body.last_service_mileage) {
        changedFields.push({
          field_name: 'last_service_mileage',
          old_value: currentRecord.last_service_mileage?.toString() || null,
          new_value: body.last_service_mileage?.toString() || null,
          value_type: 'mileage'
        });
      }
    }
    
    if (body.cambelt_due_mileage !== undefined) {
      updates.cambelt_due_mileage = body.cambelt_due_mileage;
      if (currentRecord.cambelt_due_mileage !== body.cambelt_due_mileage) {
        changedFields.push({
          field_name: 'cambelt_due_mileage',
          old_value: currentRecord.cambelt_due_mileage?.toString() || null,
          new_value: body.cambelt_due_mileage?.toString() || null,
          value_type: 'mileage'
        });
      }
    }
    
    if (body.tracker_id !== undefined) {
      updates.tracker_id = body.tracker_id;
      if (currentRecord.tracker_id !== body.tracker_id) {
        changedFields.push({
          field_name: 'tracker_id',
          old_value: currentRecord.tracker_id,
          new_value: body.tracker_id,
          value_type: 'text'
        });
      }
    }
    
    if (body.notes !== undefined) {
      updates.notes = body.notes;
      if (currentRecord.notes !== body.notes) {
        changedFields.push({
          field_name: 'notes',
          old_value: currentRecord.notes,
          new_value: body.notes,
          value_type: 'text'
        });
      }
    }
    
    // If no fields changed, still create history entry but just return current record
    if (changedFields.length === 0) {
      // Create history entry for the update attempt
      await supabase
        .from('maintenance_history')
        .insert({
          vehicle_id: currentRecord.vehicle_id,
          field_name: 'no_changes',
          old_value: null,
          new_value: null,
          value_type: 'text',
          comment: body.comment,
          updated_by: user.id,
          updated_by_name: userName
        });
      
      return NextResponse.json({
        success: true,
        maintenance: currentRecord,
        message: 'No changes detected, but comment saved to history'
      });
    }
    
    // Update maintenance record
    const { data: updatedMaintenance, error: updateError } = await supabase
      .from('vehicle_maintenance')
      .update(updates)
      .eq('id', params.id)
      .select()
      .single();
    
    if (updateError) {
      logger.error('Failed to update maintenance', updateError);
      throw updateError;
    }
    
    // Create history entries for all changed fields
    const historyEntries = changedFields.map(change => ({
      vehicle_id: currentRecord.vehicle_id,
      field_name: change.field_name,
      old_value: change.old_value,
      new_value: change.new_value,
      value_type: change.value_type,
      comment: body.comment,
      updated_by: user.id,
      updated_by_name: userName
    }));
    
    const { data: historyData, error: historyError } = await supabase
      .from('maintenance_history')
      .insert(historyEntries)
      .select()
      .single();
    
    if (historyError) {
      logger.error('Failed to create history entry', historyError);
      // Don't fail the request if history fails, just log it
    }
    
    const response: MaintenanceUpdateResponse = {
      success: true,
      maintenance: updatedMaintenance,
      history_entry: historyData
    };
    
    return NextResponse.json(response);
    
  } catch (error: any) {
    logger.error('PUT /api/maintenance/[id] failed', error, 'MaintenanceAPI');
    return NextResponse.json(
      { error: 'Internal server error', details: error.message },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/maintenance/[id]
 * Delete a maintenance record (note: typically we use archive instead)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    // Auth check
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    // Delete maintenance record (CASCADE will handle history)
    const { error: deleteError } = await supabase
      .from('vehicle_maintenance')
      .delete()
      .eq('id', params.id);
    
    if (deleteError) {
      logger.error('Failed to delete maintenance', deleteError);
      throw deleteError;
    }
    
    return NextResponse.json({ success: true });
    
  } catch (error: any) {
    logger.error('DELETE /api/maintenance/[id] failed', error, 'MaintenanceAPI');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
