import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';

const WORKSHOP_ACTION_TYPES = ['inspection_defect', 'workshop_vehicle_task'] as const;

export async function GET() {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const [canViewActions, canViewWorkshopTasks] = await Promise.all([
      canEffectiveRoleAccessModule('actions'),
      canEffectiveRoleAccessModule('workshop-tasks'),
    ]);

    if (!canViewActions) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const admin = createAdminClient();
    let actionsQuery = admin
      .from('actions')
      .select(`
        *,
        vans (
          reg_number
        ),
        hgvs (
          reg_number
        ),
        inspection_items (
          item_description,
          status
        ),
        plant (
          plant_id,
          nickname
        )
      `)
      .order('created_at', { ascending: false });

    if (!canViewWorkshopTasks) {
      WORKSHOP_ACTION_TYPES.forEach((actionType) => {
        actionsQuery = actionsQuery.neq('action_type', actionType);
      });
    }

    const { data, error } = await actionsQuery;
    if (error) {
      return NextResponse.json(
        { error: 'Failed to load actions', details: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ actions: data || [] });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return NextResponse.json(
      { error: 'Internal server error', details: message },
      { status: 500 }
    );
  }
}
