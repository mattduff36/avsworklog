import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { getProfileWithRole } from '@/lib/utils/permissions';
import { logServerError } from '@/lib/utils/server-error-logger';

// GET - List all categories
export async function GET(request: NextRequest) {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Fetch categories
    const { data: categories, error } = await supabase
      .from('vehicle_categories')
      .select('*')
      .order('name');

    if (error) throw error;

    return NextResponse.json({ categories: categories || [] });
  } catch (error) {
    console.error('Error fetching categories:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/categories',
      additionalData: {
        endpoint: '/api/admin/categories',
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// POST - Create new category
export async function POST(request: NextRequest) {
  try {
    const supabase = await createServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Check if user is admin
    const profile = await getProfileWithRole(user.id);

    if (!profile || profile.role?.name !== 'admin') {
      return NextResponse.json(
        { error: 'Forbidden: Admin access required' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const { name, description, applies_to } = body;

    // Validate required fields
    if (!name) {
      return NextResponse.json(
        { error: 'Category name is required' },
        { status: 400 }
      );
    }

    // Validate applies_to if provided
    if (applies_to && (!Array.isArray(applies_to) || applies_to.length === 0)) {
      return NextResponse.json(
        { error: 'applies_to must be a non-empty array' },
        { status: 400 }
      );
    }

    const validAppliesTo = applies_to && applies_to.length > 0 ? applies_to : ['vehicle'];

    // Insert category
    const { data, error } = await supabase
      .from('vehicle_categories')
      .insert({
        name: name.trim(),
        description: description?.trim() || null,
        applies_to: validAppliesTo,
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json(
          { error: 'Category with this name already exists' },
          { status: 400 }
        );
      }
      throw error;
    }

    return NextResponse.json({ category: data });
  } catch (error) {
    console.error('Error creating category:', error);

    await logServerError({
      error: error as Error,
      request,
      componentName: '/api/admin/categories',
      additionalData: {
        endpoint: '/api/admin/categories',
      },
    });
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

