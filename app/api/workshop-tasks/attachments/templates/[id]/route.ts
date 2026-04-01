import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { logServerError } from '@/lib/utils/server-error-logger';
import { canEffectiveRoleAccessModule } from '@/lib/utils/rbac';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/workshop-tasks/attachments/templates/[id]
 * Get a single attachment template.
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    type DbClient = { from: (t: string) => ReturnType<typeof supabase.from> };
    const db = supabase as unknown as DbClient;
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get template
    const { data: template, error: templateError } = await db
      .from('workshop_attachment_templates')
      .select('*')
      .eq('id', id)
      .single();

    if (templateError) {
      if (templateError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Template not found' }, { status: 404 });
      }
      throw templateError;
    }

    return NextResponse.json({
      success: true,
      template,
    });
  } catch (error) {
    const { id } = await params;
    console.error('Error fetching attachment template:', error);
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/workshop-tasks/attachments/templates/[id]',
      additionalData: {
        endpoint: `GET /api/workshop-tasks/attachments/templates/${id}`,
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/workshop-tasks/attachments/templates/[id]
 * Update an attachment template (manager/admin only)
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    type DbClient = { from: (t: string) => ReturnType<typeof supabase.from> };
    const db = supabase as unknown as DbClient;
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const canManageWorkshopTasks = await canEffectiveRoleAccessModule('workshop-tasks');
    if (!canManageWorkshopTasks) {
      return NextResponse.json(
        { error: 'Forbidden: Workshop Tasks access required' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { name, description, is_active } = body;

    // Build update object
    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name.trim();
    if (description !== undefined) updates.description = description?.trim() || null;
    if (is_active !== undefined) updates.is_active = is_active;

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: 'No fields to update' },
        { status: 400 }
      );
    }

    const { data: template, error: updateError } = await db
      .from('workshop_attachment_templates')
      .update(updates as never)
      .eq('id', id)
      .select('*')
      .single();

    if (updateError) {
      if (updateError.code === 'PGRST116') {
        return NextResponse.json({ error: 'Template not found' }, { status: 404 });
      }
      throw updateError;
    }

    return NextResponse.json({
      success: true,
      template,
    });
  } catch (error) {
    const { id } = await params;
    console.error('Error updating attachment template:', error);
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/workshop-tasks/attachments/templates/[id]',
      additionalData: {
        endpoint: `PUT /api/workshop-tasks/attachments/templates/${id}`,
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/workshop-tasks/attachments/templates/[id]
 * Delete an attachment template (manager/admin only)
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    type DbClient = { from: (t: string) => ReturnType<typeof supabase.from> };
    const db = supabase as unknown as DbClient;
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const canManageWorkshopTasks = await canEffectiveRoleAccessModule('workshop-tasks');
    if (!canManageWorkshopTasks) {
      return NextResponse.json(
        { error: 'Forbidden: Workshop Tasks access required' },
        { status: 403 }
      );
    }

    const { error: deleteError } = await db
      .from('workshop_attachment_templates')
      .delete()
      .eq('id', id);

    if (deleteError) {
      throw deleteError;
    }

    return NextResponse.json({
      success: true,
      message: 'Template deleted',
    });
  } catch (error) {
    const { id } = await params;
    console.error('Error deleting attachment template:', error);
    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/workshop-tasks/attachments/templates/[id]',
      additionalData: {
        endpoint: `DELETE /api/workshop-tasks/attachments/templates/${id}`,
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
