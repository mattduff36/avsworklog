BEGIN;

CREATE TABLE IF NOT EXISTS public.inventory_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  linked_van_id UUID REFERENCES public.vans(id) ON DELETE SET NULL,
  linked_hgv_id UUID REFERENCES public.hgvs(id) ON DELETE SET NULL,
  linked_plant_id UUID REFERENCES public.plant(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT inventory_locations_one_linked_asset CHECK (
    ((linked_van_id IS NOT NULL)::INT + (linked_hgv_id IS NOT NULL)::INT + (linked_plant_id IS NOT NULL)::INT) <= 1
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_locations_active_name_idx
  ON public.inventory_locations (LOWER(BTRIM(name)))
  WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS inventory_locations_linked_van_idx
  ON public.inventory_locations (linked_van_id)
  WHERE linked_van_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS inventory_locations_linked_hgv_idx
  ON public.inventory_locations (linked_hgv_id)
  WHERE linked_hgv_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS inventory_locations_linked_plant_idx
  ON public.inventory_locations (linked_plant_id)
  WHERE linked_plant_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.inventory_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_number TEXT NOT NULL,
  item_number_normalized TEXT NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'minor_plant',
  location_id UUID NOT NULL REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  last_checked_at DATE,
  status TEXT NOT NULL DEFAULT 'active',
  source TEXT,
  source_reference TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  CONSTRAINT inventory_items_category_check CHECK (
    category IN ('hired_plant', 'signs', 'minor_plant', 'tools', 'equipment', 'unknown')
  ),
  CONSTRAINT inventory_items_status_check CHECK (status IN ('active', 'inactive'))
);

CREATE UNIQUE INDEX IF NOT EXISTS inventory_items_number_normalized_idx
  ON public.inventory_items (item_number_normalized);

CREATE INDEX IF NOT EXISTS inventory_items_location_idx
  ON public.inventory_items (location_id);

CREATE INDEX IF NOT EXISTS inventory_items_last_checked_idx
  ON public.inventory_items (last_checked_at);

CREATE INDEX IF NOT EXISTS inventory_items_status_idx
  ON public.inventory_items (status);

CREATE TABLE IF NOT EXISTS public.inventory_item_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id UUID NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  from_location_id UUID REFERENCES public.inventory_locations(id) ON DELETE SET NULL,
  to_location_id UUID NOT NULL REFERENCES public.inventory_locations(id) ON DELETE RESTRICT,
  note TEXT,
  moved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  moved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS inventory_item_movements_item_idx
  ON public.inventory_item_movements (item_id, moved_at DESC);

CREATE INDEX IF NOT EXISTS inventory_item_movements_to_location_idx
  ON public.inventory_item_movements (to_location_id);

CREATE TABLE IF NOT EXISTS public.inventory_import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_files TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  import_policy TEXT NOT NULL,
  imported_count INTEGER NOT NULL DEFAULT 0,
  skipped_count INTEGER NOT NULL DEFAULT 0,
  duplicate_count INTEGER NOT NULL DEFAULT 0,
  exception_count INTEGER NOT NULL DEFAULT 0,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS public.inventory_import_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES public.inventory_import_batches(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  item_number TEXT,
  item_name TEXT,
  source_file TEXT NOT NULL,
  source_sheet TEXT,
  source_row INTEGER,
  raw_payload JSONB NOT NULL DEFAULT '{}'::JSONB,
  resolution TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS inventory_import_exceptions_batch_idx
  ON public.inventory_import_exceptions (batch_id, kind);

DROP TRIGGER IF EXISTS set_updated_at_inventory_locations ON public.inventory_locations;
CREATE TRIGGER set_updated_at_inventory_locations
  BEFORE UPDATE ON public.inventory_locations
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at_inventory_items ON public.inventory_items;
CREATE TRIGGER set_updated_at_inventory_items
  BEFORE UPDATE ON public.inventory_items
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.inventory_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_item_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inventory_import_exceptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventory_locations_select ON public.inventory_locations;
CREATE POLICY inventory_locations_select ON public.inventory_locations
  FOR SELECT TO authenticated
  USING (public.effective_has_module_permission('inventory'));

DROP POLICY IF EXISTS inventory_locations_insert ON public.inventory_locations;
CREATE POLICY inventory_locations_insert ON public.inventory_locations
  FOR INSERT TO authenticated
  WITH CHECK (public.effective_has_module_permission('inventory'));

DROP POLICY IF EXISTS inventory_locations_update ON public.inventory_locations;
CREATE POLICY inventory_locations_update ON public.inventory_locations
  FOR UPDATE TO authenticated
  USING (public.effective_has_module_permission('inventory'))
  WITH CHECK (public.effective_has_module_permission('inventory'));

DROP POLICY IF EXISTS inventory_locations_delete ON public.inventory_locations;
CREATE POLICY inventory_locations_delete ON public.inventory_locations
  FOR DELETE TO authenticated
  USING (public.effective_is_super_admin() OR public.effective_has_role_name('admin'));

DROP POLICY IF EXISTS inventory_items_select ON public.inventory_items;
CREATE POLICY inventory_items_select ON public.inventory_items
  FOR SELECT TO authenticated
  USING (public.effective_has_module_permission('inventory'));

DROP POLICY IF EXISTS inventory_items_insert ON public.inventory_items;
CREATE POLICY inventory_items_insert ON public.inventory_items
  FOR INSERT TO authenticated
  WITH CHECK (public.effective_has_module_permission('inventory'));

DROP POLICY IF EXISTS inventory_items_update ON public.inventory_items;
CREATE POLICY inventory_items_update ON public.inventory_items
  FOR UPDATE TO authenticated
  USING (public.effective_has_module_permission('inventory'))
  WITH CHECK (public.effective_has_module_permission('inventory'));

DROP POLICY IF EXISTS inventory_items_delete ON public.inventory_items;
CREATE POLICY inventory_items_delete ON public.inventory_items
  FOR DELETE TO authenticated
  USING (public.effective_is_super_admin() OR public.effective_has_role_name('admin'));

DROP POLICY IF EXISTS inventory_item_movements_select ON public.inventory_item_movements;
CREATE POLICY inventory_item_movements_select ON public.inventory_item_movements
  FOR SELECT TO authenticated
  USING (public.effective_has_module_permission('inventory'));

DROP POLICY IF EXISTS inventory_item_movements_insert ON public.inventory_item_movements;
CREATE POLICY inventory_item_movements_insert ON public.inventory_item_movements
  FOR INSERT TO authenticated
  WITH CHECK (public.effective_has_module_permission('inventory'));

DROP POLICY IF EXISTS inventory_import_batches_select ON public.inventory_import_batches;
CREATE POLICY inventory_import_batches_select ON public.inventory_import_batches
  FOR SELECT TO authenticated
  USING (public.effective_has_module_permission('inventory'));

DROP POLICY IF EXISTS inventory_import_batches_insert ON public.inventory_import_batches;
CREATE POLICY inventory_import_batches_insert ON public.inventory_import_batches
  FOR INSERT TO authenticated
  WITH CHECK (public.effective_has_module_permission('inventory'));

DROP POLICY IF EXISTS inventory_import_exceptions_select ON public.inventory_import_exceptions;
CREATE POLICY inventory_import_exceptions_select ON public.inventory_import_exceptions
  FOR SELECT TO authenticated
  USING (public.effective_has_module_permission('inventory'));

DROP POLICY IF EXISTS inventory_import_exceptions_insert ON public.inventory_import_exceptions;
CREATE POLICY inventory_import_exceptions_insert ON public.inventory_import_exceptions
  FOR INSERT TO authenticated
  WITH CHECK (public.effective_has_module_permission('inventory'));

INSERT INTO public.permission_modules (module_name, minimum_role_id, sort_order)
SELECT 'inventory', roles.id, 200
FROM public.roles
WHERE roles.name = 'contractor'
ON CONFLICT (module_name) DO UPDATE
SET minimum_role_id = EXCLUDED.minimum_role_id,
    sort_order = EXCLUDED.sort_order,
    updated_at = NOW();

INSERT INTO public.role_permissions (role_id, module_name, enabled)
SELECT
  roles.id,
  'inventory',
  FALSE
FROM public.roles
ON CONFLICT (role_id, module_name) DO NOTHING;

INSERT INTO public.team_module_permissions (team_id, module_name, enabled)
SELECT org_teams.id, 'inventory', TRUE
FROM public.org_teams
WHERE org_teams.active = TRUE
ON CONFLICT (team_id, module_name) DO NOTHING;

COMMIT;
