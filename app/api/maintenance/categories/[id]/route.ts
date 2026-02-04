import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/utils/logger';
import type { UpdateCategoryRequest } from '@/types/maintenance';

/**
 * PUT /api/maintenance/categories/[id]
 * Update maintenance category (Admin/Manager only)
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Check if user is admin/manager
    const { data: profile } = await supabase
      .from('profiles')
      .select('role:roles(name)')
      .eq('id', user.id)
      .single();
    
    const roleName = (profile?.role as any)?.name;
    if (!roleName || !['admin', 'manager'].includes(roleName)) {
      return NextResponse.json(
        { error: 'Only admins and managers can update categories' },
        { status: 403 }
      );
    }
    
    const body: UpdateCategoryRequest = await request.json();
    
    // Build update object
    const updates: Record<string, any> = {};
    if (body.name !== undefined) updates.name = body.name;
    if (body.description !== undefined) updates.description = body.description;
    if (body.alert_threshold_days !== undefined) updates.alert_threshold_days = body.alert_threshold_days;
    if (body.alert_threshold_miles !== undefined) updates.alert_threshold_miles = body.alert_threshold_miles;
    if (body.alert_threshold_hours !== undefined) updates.alert_threshold_hours = body.alert_threshold_hours;
    if (body.applies_to !== undefined) updates.applies_to = body.applies_to;
    if (body.is_active !== undefined) updates.is_active = body.is_active;
    if (body.sort_order !== undefined) updates.sort_order = body.sort_order;
    if (body.responsibility !== undefined) updates.responsibility = body.responsibility;
    if (body.show_on_overview !== undefined) updates.show_on_overview = body.show_on_overview;
    if (body.reminder_in_app_enabled !== undefined) updates.reminder_in_app_enabled = body.reminder_in_app_enabled;
    if (body.reminder_email_enabled !== undefined) updates.reminder_email_enabled = body.reminder_email_enabled;
    
    const { data, error } = await supabase
      .from('maintenance_categories')
      .update(updates)
      .eq('id', id)
      .select()
      .single();
    
    if (error) {
      logger.error('Failed to update category', error);
      throw error;
    }
    
    return NextResponse.json({ success: true, category: data });
    
  } catch (error: any) {
    logger.error('PUT /api/maintenance/categories/[id] failed', error, 'MaintenanceAPI');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * DELETE /api/maintenance/categories/[id]
 * Delete maintenance category (Admin/Manager only)
 * Fails if category is in use
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Check if user is admin/manager
    const { data: profile } = await supabase
      .from('profiles')
      .select('role:roles(name)')
      .eq('id', user.id)
      .single();
    
    const roleName = (profile?.role as any)?.name;
    if (!roleName || !['admin', 'manager'].includes(roleName)) {
      return NextResponse.json(
        { error: 'Only admins and managers can delete categories' },
        { status: 403 }
      );
    }
    
    // Check if category is in use (check maintenance_history)
    const { count } = await supabase
      .from('maintenance_history')
      .select('id', { count: 'exact', head: true })
      .eq('maintenance_category_id', id);
    
    if (count && count > 0) {
      return NextResponse.json(
        { error: `Cannot delete category: ${count} maintenance record(s) reference this category` },
        { status: 409 }
      );
    }
    
    // Delete category
    const { error } = await supabase
      .from('maintenance_categories')
      .delete()
      .eq('id', id);
    
    if (error) {
      logger.error('Failed to delete category', error);
      throw error;
    }
    
    return NextResponse.json({ success: true });
    
  } catch (error: any) {
    logger.error('DELETE /api/maintenance/categories/[id] failed', error, 'MaintenanceAPI');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
