import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/utils/logger';
import type {
  CreateCategoryRequest,
  CategoriesListResponse
} from '@/types/maintenance';

/**
 * GET /api/maintenance/categories
 * Returns all maintenance categories
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
    }
    
    // Get all categories (RLS handles permission check)
    const { data: categories, error } = await supabase
      .from('maintenance_categories')
      .select('*')
      .order('sort_order');
    
    if (error) {
      logger.error('Failed to fetch categories', error);
      throw error;
    }
    
    const response: CategoriesListResponse = {
      success: true,
      categories: categories || []
    };
    
    return NextResponse.json(response);
    
  } catch (error: any) {
    logger.error('GET /api/maintenance/categories failed', error, 'MaintenanceAPI');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * POST /api/maintenance/categories
 * Create new maintenance category (Admin/Manager only)
 */
export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
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
        { error: 'Only admins and managers can create categories' },
        { status: 403 }
      );
    }
    
    // Parse request body
    const body: CreateCategoryRequest = await request.json();
    
    // Validate required fields
    if (!body.name || !body.type) {
      return NextResponse.json(
        { error: 'Name and type are required' },
        { status: 400 }
      );
    }
    
    // Validate type
    if (!['date', 'mileage', 'hours'].includes(body.type)) {
      return NextResponse.json(
        { error: 'Type must be either "date", "mileage", or "hours"' },
        { status: 400 }
      );
    }
    
    // Validate threshold
    if (body.type === 'date' && !body.alert_threshold_days) {
      return NextResponse.json(
        { error: 'alert_threshold_days is required for date-based categories' },
        { status: 400 }
      );
    }
    
    if (body.type === 'mileage' && !body.alert_threshold_miles) {
      return NextResponse.json(
        { error: 'alert_threshold_miles is required for mileage-based categories' },
        { status: 400 }
      );
    }
    
    if (body.type === 'hours' && !body.alert_threshold_hours) {
      return NextResponse.json(
        { error: 'alert_threshold_hours is required for hours-based categories' },
        { status: 400 }
      );
    }
    
    // Create category
    const { data, error } = await supabase
      .from('maintenance_categories')
      .insert({
        name: body.name,
        description: body.description || null,
        type: body.type,
        alert_threshold_days: body.type === 'date' ? body.alert_threshold_days : null,
        alert_threshold_miles: body.type === 'mileage' ? body.alert_threshold_miles : null,
        alert_threshold_hours: body.type === 'hours' ? body.alert_threshold_hours : null,
        applies_to: body.applies_to || ['vehicle'],
        sort_order: body.sort_order || 999,
        is_active: true,
        responsibility: body.responsibility || 'workshop',
        show_on_overview: body.show_on_overview !== false, // Default true
        reminder_in_app_enabled: body.reminder_in_app_enabled || false,
        reminder_email_enabled: body.reminder_email_enabled || false,
      })
      .select()
      .single();
    
    if (error) {
      // Check for unique constraint violation
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'A category with this name already exists' },
          { status: 409 }
        );
      }
      logger.error('Failed to create category', error);
      throw error;
    }
    
    return NextResponse.json({ success: true, category: data }, { status: 201 });
    
  } catch (error: any) {
    logger.error('POST /api/maintenance/categories failed', error, 'MaintenanceAPI');
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
