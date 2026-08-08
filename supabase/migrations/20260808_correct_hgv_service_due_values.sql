-- Correct HGV Service due KM values from the approved spreadsheet Engine Service column.
-- Add display_name so HGV can show "Service Due" without colliding with Van's unique name.
-- Safe to re-run when state is already fully corrected.

ALTER TABLE public.maintenance_categories
  ADD COLUMN IF NOT EXISTS display_name VARCHAR(100) NULL;

DO $$
DECLARE
  v_service_hgv_id UUID;
  v_matched INT;
  v_wrong_state INT;
  v_corrected_state INT;
  v_completion_count INT;
  v_not_set_touched INT;
  v_test_touched INT;
BEGIN
  SELECT id INTO v_service_hgv_id
  FROM public.maintenance_categories
  WHERE config_key = 'service_hgv'
  LIMIT 1;

  IF v_service_hgv_id IS NULL THEN
    RAISE EXCEPTION 'service_hgv category not found';
  END IF;

  -- Serialize correction against concurrent service updates.
  PERFORM pg_advisory_xact_lock(hashtext('correct_hgv_service_due_values'));

  CREATE TEMP TABLE tmp_hgv_service_due_correction (
    reg_norm TEXT PRIMARY KEY,
    expected_old INTEGER NOT NULL,
    corrected INTEGER NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO tmp_hgv_service_due_correction (reg_norm, expected_old, corrected) VALUES
    ('AS71AVS', 300402, 300402),
    ('DS71AVS', 300000, 306993),
    ('ES71AVS', 225000, 302137),
    ('KS21AVS', 420000, 420000),
    ('KS71AVS', 275000, 90000),
    ('PS71AVS', 300000, 341633),
    ('SS15AVS', 75000, 650000),
    ('TS71AVS', 300000, 260000),
    ('VS71AVS', 250000, 325906),
    ('XT71AVS', 90000, 170000);

  CREATE TEMP TABLE tmp_hgv_targets AS
  SELECT
    h.id AS hgv_id,
    h.reg_number,
    c.expected_old,
    c.corrected,
    vm.next_service_mileage AS vm_due,
    cv.due_mileage AS cv_due,
    vm.next_service_template_id,
    vm.next_service_rotation_step_id,
    vm.last_service_template_id,
    vm.last_service_mileage
  FROM tmp_hgv_service_due_correction c
  JOIN public.hgvs h
    ON UPPER(regexp_replace(h.reg_number, '[^A-Z0-9]', '', 'g')) = c.reg_norm
  JOIN public.vehicle_maintenance vm
    ON vm.hgv_id = h.id
  JOIN public.asset_maintenance_category_values cv
    ON cv.hgv_id = h.id
   AND cv.maintenance_category_id = v_service_hgv_id;

  -- Lock target rows before mutating, then refresh dues under those locks.
  PERFORM 1
  FROM public.vehicle_maintenance vm
  JOIN tmp_hgv_targets t ON t.hgv_id = vm.hgv_id
  FOR UPDATE OF vm;

  PERFORM 1
  FROM public.asset_maintenance_category_values cv
  JOIN tmp_hgv_targets t ON t.hgv_id = cv.hgv_id
  WHERE cv.maintenance_category_id = v_service_hgv_id
  FOR UPDATE OF cv;

  UPDATE tmp_hgv_targets t
  SET
    vm_due = vm.next_service_mileage,
    cv_due = cv.due_mileage,
    next_service_template_id = vm.next_service_template_id,
    next_service_rotation_step_id = vm.next_service_rotation_step_id,
    last_service_template_id = vm.last_service_template_id,
    last_service_mileage = vm.last_service_mileage
  FROM public.vehicle_maintenance vm
  JOIN public.asset_maintenance_category_values cv
    ON cv.hgv_id = vm.hgv_id
   AND cv.maintenance_category_id = v_service_hgv_id
  WHERE vm.hgv_id = t.hgv_id;

  SELECT COUNT(*) INTO v_matched FROM tmp_hgv_targets;
  IF v_matched <> 10 THEN
    RAISE EXCEPTION 'Expected 10 HGV correction targets, found %', v_matched;
  END IF;

  SELECT COUNT(*) INTO v_completion_count
  FROM tmp_hgv_targets t
  WHERE EXISTS (
    SELECT 1
    FROM public.asset_service_events e
    WHERE e.hgv_id = t.hgv_id
      AND e.event_type = 'completion'
  );
  IF v_completion_count <> 0 THEN
    RAISE EXCEPTION 'Aborting: % target HGV(s) have completion service events', v_completion_count;
  END IF;

  -- Each row must be fully on the expected-old or corrected dual-write state.
  -- Rows where expected_old = corrected (already-correct dues) count once.
  SELECT COUNT(*) INTO v_wrong_state
  FROM tmp_hgv_targets
  WHERE vm_due = expected_old
    AND cv_due = expected_old
    AND expected_old IS DISTINCT FROM corrected;

  SELECT COUNT(*) INTO v_corrected_state
  FROM tmp_hgv_targets
  WHERE vm_due = corrected
    AND cv_due = corrected;

  IF (
    SELECT COUNT(*)
    FROM tmp_hgv_targets
    WHERE NOT (
      (vm_due = expected_old AND cv_due = expected_old)
      OR (vm_due = corrected AND cv_due = corrected)
    )
  ) <> 0 THEN
    RAISE EXCEPTION
      'Aborting: due stores drifted (needs_correction=%, already_corrected=%). Reconcile manually.',
      v_wrong_state, v_corrected_state;
  END IF;

  UPDATE public.vehicle_maintenance vm
  SET
    next_service_mileage = t.corrected,
    updated_at = NOW()
  FROM tmp_hgv_targets t
  WHERE vm.hgv_id = t.hgv_id
    AND vm.next_service_mileage IS DISTINCT FROM t.corrected;

  UPDATE public.asset_maintenance_category_values cv
  SET
    due_mileage = t.corrected,
    last_updated_at = NOW(),
    updated_at = NOW()
  FROM tmp_hgv_targets t
  WHERE cv.hgv_id = t.hgv_id
    AND cv.maintenance_category_id = v_service_hgv_id
    AND cv.due_mileage IS DISTINCT FROM t.corrected;

  UPDATE public.maintenance_categories
  SET
    display_name = 'Service Due',
    updated_at = NOW()
  WHERE id = v_service_hgv_id
    AND display_name IS DISTINCT FROM 'Service Due';

  -- Post-conditions
  IF EXISTS (
    SELECT 1
    FROM tmp_hgv_targets t
    JOIN public.vehicle_maintenance vm ON vm.hgv_id = t.hgv_id
    JOIN public.asset_maintenance_category_values cv
      ON cv.hgv_id = t.hgv_id
     AND cv.maintenance_category_id = v_service_hgv_id
    WHERE vm.next_service_mileage IS DISTINCT FROM t.corrected
       OR cv.due_mileage IS DISTINCT FROM t.corrected
       OR vm.next_service_template_id IS DISTINCT FROM t.next_service_template_id
       OR vm.next_service_rotation_step_id IS DISTINCT FROM t.next_service_rotation_step_id
       OR vm.last_service_template_id IS DISTINCT FROM t.last_service_template_id
       OR vm.last_service_mileage IS DISTINCT FROM t.last_service_mileage
  ) THEN
    RAISE EXCEPTION 'Post-condition failed: dues or rotation fingerprints changed unexpectedly';
  END IF;

  SELECT COUNT(*) INTO v_not_set_touched
  FROM public.hgvs h
  JOIN public.vehicle_maintenance vm ON vm.hgv_id = h.id
  WHERE UPPER(regexp_replace(h.reg_number, '[^A-Z0-9]', '', 'g')) IN ('C517773', 'FL21TVE')
    AND vm.next_service_mileage IS NOT NULL;
  IF v_not_set_touched <> 0 THEN
    RAISE EXCEPTION 'Not Set HGVs must remain without next_service_mileage';
  END IF;

  SELECT COUNT(*) INTO v_test_touched
  FROM public.hgvs h
  JOIN public.vehicle_maintenance vm ON vm.hgv_id = h.id
  WHERE (
      UPPER(regexp_replace(h.reg_number, '[^A-Z0-9]', '', 'g')) = 'TE57HGV'
      OR LOWER(COALESCE(h.nickname, '')) = 'test-hgv'
    )
    AND (
      vm.next_service_mileage IS NOT NULL
      OR vm.last_service_mileage IS NOT NULL
      OR vm.next_service_template_id IS NOT NULL
      OR vm.last_service_template_id IS NOT NULL
      OR vm.next_service_rotation_step_id IS NOT NULL
    );
  IF v_test_touched <> 0 THEN
    RAISE EXCEPTION 'TEST-HGV must remain without unified service state';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.maintenance_categories
    WHERE id = v_service_hgv_id
      AND name = 'Service'
      AND config_key = 'service_hgv'
      AND display_name = 'Service Due'
  ) THEN
    RAISE EXCEPTION 'service_hgv display_name/name/config_key post-condition failed';
  END IF;
END;
$$;
