import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { logServerError } from '@/lib/utils/server-error-logger';
import { requireFleetLevel } from '@/lib/server/fleet-maintenance-auth';

export async function GET(request: NextRequest) {
  try {
    // FLEET-TIERS: category list requires Level 3+
    const auth = await requireFleetLevel(3);
    if (auth.response) {
      return auth.response;
    }

    const supabase = await createServerClient();

    const { data: categories, error } = await supabase
      .from('hgv_categories')
      .select('*')
      .order('name');

    if (error) throw error;

    return NextResponse.json({ categories: categories || [] });
  } catch (error) {
    console.error('Error fetching HGV categories:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/hgv-categories',
      additionalData: { endpoint: '/api/admin/hgv-categories' },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    // FLEET-TIERS: category create requires Level 5
    const auth = await requireFleetLevel(5, 'Forbidden: Fleet Level 5 required for category admin');
    if (auth.response) {
      return auth.response;
    }

    const supabase = await createServerClient();

    const body = await request.json();
    const { name, description } = body;

    if (!name) {
      return NextResponse.json(
        { error: 'Category name is required' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('hgv_categories')
      .insert({
        name: name.trim(),
        description: description?.trim() || null,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'HGV category with this name already exists' },
          { status: 400 }
        );
      }
      throw error;
    }

    return NextResponse.json({ category: data });
  } catch (error) {
    console.error('Error creating HGV category:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/hgv-categories',
      additionalData: { endpoint: '/api/admin/hgv-categories' },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
