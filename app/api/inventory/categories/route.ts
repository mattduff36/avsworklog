import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { requireInventoryAccess, requireInventoryManagerAccess } from '@/lib/server/inventory-auth';

interface CreateInventoryCategoryBody {
  name?: string;
  slug?: string;
  description?: string | null;
  sort_order?: number | null;
  is_active?: boolean;
}

function cleanSlug(value: string | undefined): string {
  return (value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function isValidSlug(value: string): boolean {
  return /^[a-z0-9]+(_[a-z0-9]+)*$/.test(value);
}

async function loadCategoryItemCounts(admin: ReturnType<typeof createAdminClient>) {
  const { data, error } = await admin
    .from('inventory_items')
    .select('category');

  if (error) throw error;

  return (data || []).reduce<Record<string, number>>((counts, item) => {
    const category = item.category as string | null;
    if (!category) return counts;
    counts[category] = (counts[category] || 0) + 1;
    return counts;
  }, {});
}

export async function GET() {
  try {
    const access = await requireInventoryAccess();
    if (!access.allowed) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const admin = createAdminClient();
    const [{ data: categories, error: categoriesError }, itemCounts] = await Promise.all([
      admin
        .from('inventory_item_categories')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true }),
      loadCategoryItemCounts(admin),
    ]);

    if (categoriesError) throw categoriesError;

    return NextResponse.json({
      categories: (categories || []).map((category) => ({
        ...category,
        item_count: itemCounts[category.slug] || 0,
      })),
    });
  } catch (error) {
    console.error('Error fetching inventory categories:', error);
    return NextResponse.json({ error: 'Failed to fetch inventory categories' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const access = await requireInventoryManagerAccess();
    if (!access.allowed || !access.userId) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const body = (await request.json()) as CreateInventoryCategoryBody;
    const name = body.name?.trim();
    const slug = cleanSlug(body.slug || body.name);

    if (!name) {
      return NextResponse.json({ error: 'Category name is required' }, { status: 400 });
    }
    if (!slug || !isValidSlug(slug)) {
      return NextResponse.json({ error: 'Category slug must use lowercase letters, numbers, and underscores' }, { status: 400 });
    }

    const { data, error } = await createAdminClient()
      .from('inventory_item_categories')
      .insert({
        name,
        slug,
        description: body.description?.trim() || null,
        sort_order: Number.isFinite(body.sort_order) ? body.sort_order : 0,
        is_active: body.is_active !== false,
        created_by: access.userId,
        updated_by: access.userId,
      })
      .select('*')
      .single();

    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'An inventory category with this slug already exists' }, { status: 400 });
      }
      throw error;
    }

    return NextResponse.json({ category: { ...data, item_count: 0 } }, { status: 201 });
  } catch (error) {
    console.error('Error creating inventory category:', error);
    return NextResponse.json({ error: 'Failed to create inventory category' }, { status: 500 });
  }
}
