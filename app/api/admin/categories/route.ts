import { NextRequest, NextResponse } from 'next/server';
import { createClient as createServerClient } from '@/lib/supabase/server';
import { logServerError } from '@/lib/utils/server-error-logger';
import { requireFleetLevel } from '@/lib/server/fleet-maintenance-auth';

// GET - List all categories (FLEET-TIERS: Level 3+)
export async function GET(request: NextRequest) {
  try {
    const auth = await requireFleetLevel(3);
    if (auth.response) {
      return auth.response;
    }

    const supabase = await createServerClient();

    // Fetch categories
    const { data: categories, error } = await supabase
      .from('van_categories')
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

// POST - Create new category (FLEET-TIERS: Level 5 category admin)
export async function POST(request: NextRequest) {
  try {
    const auth = await requireFleetLevel(5, 'Forbidden: Fleet Level 5 required for category admin');
    if (auth.response) {
      return auth.response;
    }

    const supabase = await createServerClient();

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

    const validAppliesTo = applies_to && applies_to.length > 0 ? applies_to : ['van'];

    // Insert category
    const { data, error } = await supabase
      .from('van_categories')
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
