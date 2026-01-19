import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

/**
 * GET /api/inspections/locked-defects?vehicleId=xxx
 * 
 * Returns locked checklist items for a vehicle where existing defect tasks are active.
 * Uses service role to bypass RLS (inspectors can't read actions table).
 * 
 * Locked items are those with workshop tasks in statuses: logged, on_hold, in_progress
 * 
 * Returns: { lockedItems: Array<{ item_number, item_description, status, actionId, comment }> }
 */
export async function GET(request: NextRequest) {
  try {
    // Verify user is authenticated
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    
    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get vehicleId from query params
    const { searchParams } = new URL(request.url);
    const vehicleId = searchParams.get('vehicleId');

    if (!vehicleId) {
      return NextResponse.json({ error: 'vehicleId is required' }, { status: 400 });
    }

    // Use service role client to bypass RLS
    const supabaseAdmin = createSupabaseClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    );

    // Find active inspection defect tasks for this vehicle
    // Include: logged, on_hold, in_progress statuses
    const { data: tasks, error: tasksError } = await supabaseAdmin
      .from('actions')
      .select(`
        id,
        status,
        logged_comment,
        workshop_comments,
        description,
        inspection_item_id,
        inspection_id
      `)
      .eq('vehicle_id', vehicleId)
      .eq('action_type', 'inspection_defect')
      .in('status', ['logged', 'on_hold', 'in_progress']);

    if (tasksError) {
      console.error('Error fetching tasks:', tasksError);
      return NextResponse.json({ error: 'Failed to fetch tasks' }, { status: 500 });
    }

    if (!tasks || tasks.length === 0) {
      // No locked items
      return NextResponse.json({ lockedItems: [] });
    }

    // Get inspection_items to extract item_number and item_description
    const itemIds = tasks.map(t => t.inspection_item_id).filter(Boolean);
    
    let lockedItems: Array<{
      item_number: number;
      item_description: string;
      status: string;
      actionId: string;
      comment: string;
    }> = [];

    if (itemIds.length > 0) {
      const { data: items } = await supabaseAdmin
        .from('inspection_items')
        .select('id, item_number, item_description')
        .in('id', itemIds);

      if (items) {
        // Build locked items list
        for (const task of tasks) {
          const item = items.find(i => i.id === task.inspection_item_id);
          
          if (item) {
            // Get comment (prefer logged_comment, then workshop_comments, then parse from description)
            let comment = task.logged_comment || task.workshop_comments || '';
            if (!comment && task.description) {
              const commentMatch = task.description.match(/Comment: (.+)/);
              if (commentMatch) {
                comment = commentMatch[1];
              }
            }

            lockedItems.push({
              item_number: item.item_number,
              item_description: item.item_description,
              status: task.status,
              actionId: task.id,
              comment: comment || 'Defect in progress'
            });
          } else {
            // Fallback: parse from description if item is deleted
            const descMatch = task.description?.match(/Item (\d+) - ([^(]+)/);
            if (descMatch) {
              const itemNumber = parseInt(descMatch[1]);
              const itemDesc = descMatch[2].trim();
              
              lockedItems.push({
                item_number: itemNumber,
                item_description: itemDesc,
                status: task.status,
                actionId: task.id,
                comment: task.logged_comment || 'Defect in progress'
              });
            }
          }
        }
      }
    }

    return NextResponse.json({ lockedItems });
  } catch (error) {
    console.error('Error in locked-defects endpoint:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
