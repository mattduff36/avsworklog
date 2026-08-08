import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { userHasPermission } from '@/lib/utils/permissions';
import { logServerError } from '@/lib/utils/server-error-logger';
import { listLinkedTemplatesForCategory } from '@/lib/server/asset-service';

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const hasPermission = await userHasPermission(user.id, 'workshop-tasks');
    if (!hasPermission) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const categoryId = request.nextUrl.searchParams.get('categoryId');
    if (!categoryId) {
      return NextResponse.json({ error: 'categoryId is required' }, { status: 400 });
    }

    const templates = await listLinkedTemplatesForCategory(categoryId);
    return NextResponse.json({
      templates: templates.filter((template) => template.isActive),
      allTemplates: templates,
    });
  } catch (error) {
    await logServerError({
      error: error instanceof Error ? error : new Error(String(error)),
      request,
      componentName: '/api/workshop-tasks/category-attachments',
      additionalData: {
        endpoint: 'GET /api/workshop-tasks/category-attachments',
      },
    });
    return NextResponse.json({ error: 'Failed to list category attachments' }, { status: 500 });
  }
}
