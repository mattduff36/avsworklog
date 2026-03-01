import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const hgvId = searchParams.get('hgvId');

    if (!hgvId) {
      return NextResponse.json({ error: 'hgvId is required' }, { status: 400 });
    }

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

    const { data: tasks, error: tasksError } = await supabaseAdmin
      .from('actions')
      .select(`
        id,
        status,
        logged_comment,
        workshop_comments,
        description,
        inspection_item_id
      `)
      .eq('hgv_id', hgvId)
      .eq('action_type', 'inspection_defect')
      .in('status', ['logged', 'on_hold', 'in_progress']);

    if (tasksError) {
      return NextResponse.json({ error: 'Failed to fetch tasks' }, { status: 500 });
    }

    if (!tasks || tasks.length === 0) {
      return NextResponse.json({ lockedItems: [] });
    }

    const itemIds = tasks.map(t => t.inspection_item_id).filter(Boolean);
    let items: Array<{ id: string; item_number: number; item_description: string }> = [];

    if (itemIds.length > 0) {
      const { data: fetchedItems } = await supabaseAdmin
        .from('inspection_items')
        .select('id, item_number, item_description')
        .in('id', itemIds);

      if (fetchedItems) {
        items = fetchedItems;
      }
    }

    const lockedItems: Array<{
      item_number: number;
      item_description: string;
      status: string;
      actionId: string;
      comment: string;
    }> = [];

    for (const task of tasks) {
      let itemNumber: number | null = null;
      let itemDescription = '';

      if (task.inspection_item_id) {
        const item = items.find(i => i.id === task.inspection_item_id);
        if (item) {
          itemNumber = item.item_number;
          itemDescription = item.item_description;
        }
      }

      if (itemNumber === null && task.description) {
        const descMatch = task.description.match(/Item (\d+) - ([^(]+)/);
        if (descMatch) {
          itemNumber = parseInt(descMatch[1], 10);
          itemDescription = descMatch[2].trim();
        }
      }

      if (itemNumber === null) {
        continue;
      }

      lockedItems.push({
        item_number: itemNumber,
        item_description: itemDescription,
        status: task.status,
        actionId: task.id,
        comment: task.logged_comment || task.workshop_comments || 'Defect in progress',
      });
    }

    return NextResponse.json({ lockedItems });
  } catch {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
