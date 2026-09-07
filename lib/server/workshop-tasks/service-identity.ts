import type pg from 'pg';

export async function loadSubcategoryParentCategoryId(
  client: pg.Client,
  subcategoryId: string | null | undefined
): Promise<string | null> {
  if (!subcategoryId) return null;
  const { rows } = await client.query<{ category_id: string }>(
    `SELECT category_id FROM public.workshop_task_subcategories WHERE id = $1 LIMIT 1`,
    [subcategoryId]
  );
  return rows[0]?.category_id ?? null;
}

export function isUnifiedServiceMembership(
  serviceWorkshopCategoryId: string | null | undefined,
  storedCategoryId: string | null | undefined,
  subcategoryParentId: string | null | undefined
): boolean {
  return Boolean(
    serviceWorkshopCategoryId &&
      (storedCategoryId === serviceWorkshopCategoryId ||
        subcategoryParentId === serviceWorkshopCategoryId)
  );
}
