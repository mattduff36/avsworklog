-- Restore inspection-form van creation after permission-alignment over-tightened INSERT.
-- Fleet Level 4 keeps unrestricted insert. Inspection users may only create active vans
-- with a registration + van-applicable category and vehicle-shaped metadata.
-- Workstream: ws_vans_rls_fixerrors_20260810

BEGIN;

DROP POLICY IF EXISTS "Users can add vans" ON public.vans;

CREATE POLICY "Users can add vans" ON public.vans
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.effective_has_module_level('admin-vans', 4))
    OR (
      (SELECT public.effective_has_module_permission('inspections'))
      AND status = 'active'
      AND reg_number IS NOT NULL
      AND btrim(reg_number) <> ''
      AND category_id IS NOT NULL
      AND COALESCE(asset_type, 'vehicle') = 'vehicle'
      AND plant_id IS NULL
      AND serial_number IS NULL
      AND nickname IS NULL
      AND year IS NULL
      AND weight_class IS NULL
      AND EXISTS (
        SELECT 1
        FROM public.van_categories vc
        WHERE vc.id = category_id
          AND (
            vc.applies_to IS NULL
            OR cardinality(vc.applies_to) = 0
            OR 'van' = ANY (vc.applies_to)
            OR 'vehicle' = ANY (vc.applies_to)
          )
      )
    )
  );

COMMIT;
