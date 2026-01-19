import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logger } from '@/lib/utils/logger';

interface RecipientWithProfile {
  id: string;
  category_id: string;
  user_id: string;
  created_at: string;
  profile?: {
    full_name: string | null;
  };
}

/**
 * GET /api/maintenance/categories/[id]/recipients
 * Get all recipients for a category
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: categoryId } = await params;
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Get recipients with profile info
    const { data: recipients, error } = await supabase
      .from('maintenance_category_recipients')
      .select(`
        id,
        category_id,
        user_id,
        created_at,
        profile:profiles(full_name)
      `)
      .eq('category_id', categoryId);
    
    if (error) {
      logger.error('Failed to fetch category recipients', error);
      throw error;
    }
    
    return NextResponse.json({ 
      success: true, 
      recipients: recipients || [] 
    });
    
  } catch (error: any) {
    logger.error('GET /api/maintenance/categories/[id]/recipients failed', error, 'MaintenanceAPI');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/**
 * POST /api/maintenance/categories/[id]/recipients
 * Add recipients to a category (replace all)
 * Body: { user_ids: string[] }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: categoryId } = await params;
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Check if user is admin/manager
    const { data: profile } = await supabase
      .from('profiles')
      .select('role:roles(name, is_manager_admin)')
      .eq('id', user.id)
      .single();
    
    const roleData = profile?.role as { name: string; is_manager_admin: boolean } | null;
    if (!roleData?.is_manager_admin && roleData?.name !== 'admin' && roleData?.name !== 'manager') {
      return NextResponse.json(
        { error: 'Only admins and managers can manage recipients' },
        { status: 403 }
      );
    }
    
    // Parse request body
    const body = await request.json();
    const { user_ids } = body as { user_ids: string[] };
    
    if (!Array.isArray(user_ids)) {
      return NextResponse.json(
        { error: 'user_ids must be an array' },
        { status: 400 }
      );
    }
    
    // Verify category exists
    const { data: category, error: categoryError } = await supabase
      .from('maintenance_categories')
      .select('id')
      .eq('id', categoryId)
      .single();
    
    if (categoryError || !category) {
      return NextResponse.json({ error: 'Category not found' }, { status: 404 });
    }
    
    // Delete existing recipients
    const { error: deleteError } = await supabase
      .from('maintenance_category_recipients')
      .delete()
      .eq('category_id', categoryId);
    
    if (deleteError) {
      logger.error('Failed to delete existing recipients', deleteError);
      throw deleteError;
    }
    
    // Insert new recipients (if any)
    if (user_ids.length > 0) {
      const newRecipients = user_ids.map(userId => ({
        category_id: categoryId,
        user_id: userId,
      }));
      
      const { error: insertError } = await supabase
        .from('maintenance_category_recipients')
        .insert(newRecipients);
      
      if (insertError) {
        logger.error('Failed to insert new recipients', insertError);
        throw insertError;
      }
    }
    
    // Fetch updated recipients with profile info
    const { data: recipients, error: fetchError } = await supabase
      .from('maintenance_category_recipients')
      .select(`
        id,
        category_id,
        user_id,
        created_at,
        profile:profiles(full_name)
      `)
      .eq('category_id', categoryId);
    
    if (fetchError) {
      logger.error('Failed to fetch updated recipients', fetchError);
    }
    
    return NextResponse.json({ 
      success: true, 
      recipients: recipients || [],
      count: user_ids.length 
    });
    
  } catch (error: any) {
    logger.error('POST /api/maintenance/categories/[id]/recipients failed', error, 'MaintenanceAPI');
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
