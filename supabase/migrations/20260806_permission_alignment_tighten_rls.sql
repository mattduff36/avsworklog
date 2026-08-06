-- Phase 3: tighten RLS policies to the module access-level boundaries.
-- Workstream: ws_permission_alignment_20260806

BEGIN;

CREATE OR REPLACE FUNCTION public.effective_has_module_level(
  target_module TEXT,
  minimum_level INTEGER
)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.effective_module_access_level(target_module) >= minimum_level;
$$;

COMMENT ON FUNCTION public.effective_has_module_level(TEXT, INTEGER)
  IS 'Returns whether the effective user has at least the requested module access level.';

REVOKE ALL ON FUNCTION public.effective_has_module_level(TEXT, INTEGER) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.effective_has_module_level(TEXT, INTEGER) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Messages / Toolbox Talks
-- Keep recipient self-service policies separate from Level 4 management.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Managers can delete messages" ON public.messages;
DROP POLICY IF EXISTS "Managers can create messages" ON public.messages;
DROP POLICY IF EXISTS "Managers and recipients can view messages" ON public.messages;
DROP POLICY IF EXISTS "Managers can view their messages" ON public.messages;
DROP POLICY IF EXISTS "Users can view assigned messages" ON public.messages;
DROP POLICY IF EXISTS "Managers can update messages" ON public.messages;

CREATE POLICY "Managers can delete messages" ON public.messages
  FOR DELETE TO authenticated
  USING ((SELECT public.effective_has_module_level('toolbox-talks', 4)));

CREATE POLICY "Managers can create messages" ON public.messages
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.effective_has_module_level('toolbox-talks', 4)));

CREATE POLICY "Managers can view their messages" ON public.messages
  FOR SELECT TO authenticated
  USING ((SELECT public.effective_has_module_level('toolbox-talks', 4)));

CREATE POLICY "Users can view assigned messages" ON public.messages
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.message_recipients
      WHERE message_recipients.message_id = messages.id
        AND message_recipients.user_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Managers can update messages" ON public.messages
  FOR UPDATE TO authenticated
  USING ((SELECT public.effective_has_module_level('toolbox-talks', 4)))
  WITH CHECK ((SELECT public.effective_has_module_level('toolbox-talks', 4)));

DROP POLICY IF EXISTS "Managers can create recipients" ON public.message_recipients;
DROP POLICY IF EXISTS "Managers can view all recipients" ON public.message_recipients;
DROP POLICY IF EXISTS "Users can view their recipients" ON public.message_recipients;
DROP POLICY IF EXISTS "Managers can update recipients" ON public.message_recipients;
DROP POLICY IF EXISTS "Users can update their recipients" ON public.message_recipients;

CREATE POLICY "Managers can create recipients" ON public.message_recipients
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.effective_has_module_level('toolbox-talks', 4)));

CREATE POLICY "Managers can view all recipients" ON public.message_recipients
  FOR SELECT TO authenticated
  USING ((SELECT public.effective_has_module_level('toolbox-talks', 4)));

CREATE POLICY "Users can view their recipients" ON public.message_recipients
  FOR SELECT TO authenticated
  USING (user_id = (SELECT auth.uid()));

CREATE POLICY "Managers can update recipients" ON public.message_recipients
  FOR UPDATE TO authenticated
  USING ((SELECT public.effective_has_module_level('toolbox-talks', 4)))
  WITH CHECK ((SELECT public.effective_has_module_level('toolbox-talks', 4)));

CREATE POLICY "Users can update their recipients" ON public.message_recipients
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- ---------------------------------------------------------------------------
-- RAMS
-- Keep employee assigned-document reads and assignment signing.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Managers can delete rams documents" ON public.rams_documents;
DROP POLICY IF EXISTS "Managers can create RAMS documents" ON public.rams_documents;
DROP POLICY IF EXISTS "Employees can view assigned RAMS" ON public.rams_documents;
DROP POLICY IF EXISTS "Managers can view all rams documents" ON public.rams_documents;
DROP POLICY IF EXISTS "Managers can update rams documents" ON public.rams_documents;

CREATE POLICY "Managers can delete rams documents" ON public.rams_documents
  FOR DELETE TO authenticated
  USING ((SELECT public.effective_has_module_level('rams', 4)));

CREATE POLICY "Managers can create RAMS documents" ON public.rams_documents
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.effective_has_module_level('rams', 4)));

CREATE POLICY "Employees can view assigned RAMS" ON public.rams_documents
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.rams_assignments
      WHERE rams_assignments.rams_document_id = rams_documents.id
        AND rams_assignments.employee_id = (SELECT auth.uid())
    )
  );

CREATE POLICY "Managers can view all rams documents" ON public.rams_documents
  FOR SELECT TO authenticated
  USING ((SELECT public.effective_has_module_level('rams', 4)));

CREATE POLICY "Managers can update rams documents" ON public.rams_documents
  FOR UPDATE TO authenticated
  USING ((SELECT public.effective_has_module_level('rams', 4)))
  WITH CHECK ((SELECT public.effective_has_module_level('rams', 4)));

DROP POLICY IF EXISTS "Managers can create assignments" ON public.rams_assignments;
DROP POLICY IF EXISTS "Managers can view all assignments" ON public.rams_assignments;
DROP POLICY IF EXISTS "Users can view their assignments" ON public.rams_assignments;
DROP POLICY IF EXISTS "Employees can sign their assignments" ON public.rams_assignments;
DROP POLICY IF EXISTS "Managers can update assignments" ON public.rams_assignments;

CREATE POLICY "Managers can create assignments" ON public.rams_assignments
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.effective_has_module_level('rams', 4)));

CREATE POLICY "Managers can view all assignments" ON public.rams_assignments
  FOR SELECT TO authenticated
  USING ((SELECT public.effective_has_module_level('rams', 4)));

CREATE POLICY "Users can view their assignments" ON public.rams_assignments
  FOR SELECT TO authenticated
  USING (employee_id = (SELECT auth.uid()));

CREATE POLICY "Employees can sign their assignments" ON public.rams_assignments
  FOR UPDATE TO authenticated
  USING (employee_id = (SELECT auth.uid()))
  WITH CHECK (employee_id = (SELECT auth.uid()));

CREATE POLICY "Managers can update assignments" ON public.rams_assignments
  FOR UPDATE TO authenticated
  USING ((SELECT public.effective_has_module_level('rams', 4)))
  WITH CHECK ((SELECT public.effective_has_module_level('rams', 4)));

-- ---------------------------------------------------------------------------
-- Fleet assets
-- Level 3 can see non-active records; Level 4 can mutate.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Managers can delete vehicles" ON public.vans;
DROP POLICY IF EXISTS "Admins can manage vehicles" ON public.vans;
DROP POLICY IF EXISTS "Users can add vans" ON public.vans;
DROP POLICY IF EXISTS "Users can view active vehicles and managers can view all vehicl" ON public.vans;
DROP POLICY IF EXISTS "Managers can update vehicles" ON public.vans;

CREATE POLICY "Managers can delete vehicles" ON public.vans
  FOR DELETE TO authenticated
  USING ((SELECT public.effective_has_module_level('admin-vans', 4)));

CREATE POLICY "Users can add vans" ON public.vans
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.effective_has_module_level('admin-vans', 4)));

CREATE POLICY "Users can view active vehicles and managers can view all vehicl" ON public.vans
  FOR SELECT TO authenticated
  USING (
    status = 'active'
    OR (SELECT public.effective_has_module_level('admin-vans', 3))
  );

CREATE POLICY "Managers can update vehicles" ON public.vans
  FOR UPDATE TO authenticated
  USING ((SELECT public.effective_has_module_level('admin-vans', 4)))
  WITH CHECK ((SELECT public.effective_has_module_level('admin-vans', 4)));

DROP POLICY IF EXISTS "plant_delete_policy" ON public.plant;
DROP POLICY IF EXISTS "plant_insert_policy" ON public.plant;
DROP POLICY IF EXISTS "plant_read_policy" ON public.plant;
DROP POLICY IF EXISTS "plant_update_policy" ON public.plant;

CREATE POLICY "plant_delete_policy" ON public.plant
  FOR DELETE TO authenticated
  USING ((SELECT public.effective_has_module_level('admin-vans', 4)));

CREATE POLICY "plant_insert_policy" ON public.plant
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.effective_has_module_level('admin-vans', 4)));

CREATE POLICY "plant_read_policy" ON public.plant
  FOR SELECT TO authenticated
  USING (
    status = 'active'
    OR (SELECT public.effective_has_module_level('admin-vans', 3))
  );

CREATE POLICY "plant_update_policy" ON public.plant
  FOR UPDATE TO authenticated
  USING ((SELECT public.effective_has_module_level('admin-vans', 4)))
  WITH CHECK ((SELECT public.effective_has_module_level('admin-vans', 4)));

DROP POLICY IF EXISTS "Admins can manage hgvs" ON public.hgvs;
DROP POLICY IF EXISTS "All users can view active hgvs" ON public.hgvs;

CREATE POLICY "Admins can manage hgvs" ON public.hgvs
  FOR ALL TO authenticated
  USING ((SELECT public.effective_has_module_level('admin-vans', 4)))
  WITH CHECK ((SELECT public.effective_has_module_level('admin-vans', 4)));

CREATE POLICY "All users can view active hgvs" ON public.hgvs
  FOR SELECT TO authenticated
  USING (
    status = 'active'
    OR (SELECT public.effective_has_module_level('admin-vans', 3))
  );

-- ---------------------------------------------------------------------------
-- Maintenance
-- Level 3 operates maintenance; Level 4 manages categories and recipients.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users with permission manage maintenance" ON public.vehicle_maintenance;
CREATE POLICY "Users with permission manage maintenance" ON public.vehicle_maintenance
  FOR ALL TO authenticated
  USING ((SELECT public.effective_has_module_level('maintenance', 3)))
  WITH CHECK ((SELECT public.effective_has_module_level('maintenance', 3)));

DROP POLICY IF EXISTS "Admins manage categories" ON public.maintenance_categories;
DROP POLICY IF EXISTS "Users with permission read categories" ON public.maintenance_categories;

CREATE POLICY "Admins manage categories" ON public.maintenance_categories
  FOR ALL TO authenticated
  USING ((SELECT public.effective_has_module_level('maintenance', 4)))
  WITH CHECK ((SELECT public.effective_has_module_level('maintenance', 4)));

CREATE POLICY "Users with permission read categories" ON public.maintenance_categories
  FOR SELECT TO authenticated
  USING ((SELECT public.effective_has_module_level('maintenance', 3)));

DROP POLICY IF EXISTS "maintenance_category_recipients_delete" ON public.maintenance_category_recipients;
DROP POLICY IF EXISTS "maintenance_category_recipients_insert" ON public.maintenance_category_recipients;
DROP POLICY IF EXISTS "maintenance_category_recipients_select" ON public.maintenance_category_recipients;
DROP POLICY IF EXISTS "maintenance_category_recipients_update" ON public.maintenance_category_recipients;

CREATE POLICY "maintenance_category_recipients_delete" ON public.maintenance_category_recipients
  FOR DELETE TO authenticated
  USING ((SELECT public.effective_has_module_level('maintenance', 4)));

CREATE POLICY "maintenance_category_recipients_insert" ON public.maintenance_category_recipients
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.effective_has_module_level('maintenance', 4)));

CREATE POLICY "maintenance_category_recipients_select" ON public.maintenance_category_recipients
  FOR SELECT TO authenticated
  USING ((SELECT public.effective_has_module_level('maintenance', 4)));

CREATE POLICY "maintenance_category_recipients_update" ON public.maintenance_category_recipients
  FOR UPDATE TO authenticated
  USING ((SELECT public.effective_has_module_level('maintenance', 4)))
  WITH CHECK ((SELECT public.effective_has_module_level('maintenance', 4)));

-- ---------------------------------------------------------------------------
-- Legacy actions
-- Preserve authenticated defect inserts and workshop-task policies.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Managers can view all actions" ON public.actions;
DROP POLICY IF EXISTS "Managers can create actions" ON public.actions;
DROP POLICY IF EXISTS "Managers can update actions" ON public.actions;
DROP POLICY IF EXISTS "Managers can delete actions" ON public.actions;

CREATE POLICY "Managers can view all actions" ON public.actions
  FOR SELECT TO authenticated
  USING ((SELECT public.effective_has_module_level('actions', 4)));

CREATE POLICY "Managers can update actions" ON public.actions
  FOR UPDATE TO authenticated
  USING ((SELECT public.effective_has_module_level('actions', 4)))
  WITH CHECK ((SELECT public.effective_has_module_level('actions', 4)));

CREATE POLICY "Managers can delete actions" ON public.actions
  FOR DELETE TO authenticated
  USING ((SELECT public.effective_has_module_level('actions', 4)));

-- ---------------------------------------------------------------------------
-- Inventory
-- Catalogue mutations are Level 4. Employee move/claim flows use the guarded
-- server-side move RPC and do not directly insert or update inventory_items.
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS inventory_item_groups_insert ON public.inventory_item_groups;
DROP POLICY IF EXISTS inventory_item_groups_select ON public.inventory_item_groups;
DROP POLICY IF EXISTS inventory_item_groups_update ON public.inventory_item_groups;

CREATE POLICY inventory_item_groups_insert ON public.inventory_item_groups
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.effective_has_module_level('inventory', 4)));

CREATE POLICY inventory_item_groups_select ON public.inventory_item_groups
  FOR SELECT TO authenticated
  USING ((SELECT public.effective_has_module_level('inventory', 1)));

CREATE POLICY inventory_item_groups_update ON public.inventory_item_groups
  FOR UPDATE TO authenticated
  USING ((SELECT public.effective_has_module_level('inventory', 4)))
  WITH CHECK ((SELECT public.effective_has_module_level('inventory', 4)));

DROP POLICY IF EXISTS inventory_items_delete ON public.inventory_items;
DROP POLICY IF EXISTS inventory_items_insert ON public.inventory_items;
DROP POLICY IF EXISTS inventory_items_select ON public.inventory_items;
DROP POLICY IF EXISTS inventory_items_update ON public.inventory_items;

CREATE POLICY inventory_items_delete ON public.inventory_items
  FOR DELETE TO authenticated
  USING (public.effective_is_super_admin() OR public.effective_has_role_name('admin'));

CREATE POLICY inventory_items_insert ON public.inventory_items
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.effective_has_module_level('inventory', 4)));

CREATE POLICY inventory_items_select ON public.inventory_items
  FOR SELECT TO authenticated
  USING ((SELECT public.effective_has_module_level('inventory', 1)));

CREATE POLICY inventory_items_update ON public.inventory_items
  FOR UPDATE TO authenticated
  USING ((SELECT public.effective_has_module_level('inventory', 4)))
  WITH CHECK ((SELECT public.effective_has_module_level('inventory', 4)));

COMMIT;
