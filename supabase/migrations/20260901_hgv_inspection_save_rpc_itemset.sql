-- finalise-phase: predeploy
BEGIN;

CREATE OR REPLACE FUNCTION public.save_hgv_inspection(
  p_actor_id uuid,
  p_actor_can_manage_others boolean,
  p_subject_user_id uuid,
  p_hgv_id uuid,
  p_inspection_date date,
  p_hint_inspection_id uuid,
  p_expected_owner_id uuid,
  p_status text,
  p_current_mileage integer,
  p_inspector_comments text,
  p_signature_data text,
  p_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.hgv_inspections%ROWTYPE;
  v_found boolean := FALSE;
  v_now timestamptz := clock_timestamp();
  v_result jsonb;
BEGIN
  IF p_actor_id IS NULL OR p_subject_user_id IS NULL OR p_hgv_id IS NULL OR p_inspection_date IS NULL THEN
    RAISE EXCEPTION 'HGV_SAVE:INVALID_INPUT';
  END IF;

  IF p_status NOT IN ('draft', 'submitted') THEN
    RAISE EXCEPTION 'HGV_SAVE:INVALID_STATUS';
  END IF;

  IF p_status = 'submitted' AND (p_current_mileage IS NULL OR p_current_mileage < 0) THEN
    RAISE EXCEPTION 'HGV_SAVE:INVALID_INPUT';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'HGV_SAVE:INVALID_ITEM';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) AS elem
    WHERE COALESCE(elem->>'status', '') NOT IN ('ok', 'attention', 'defect', 'na')
       OR NULLIF(elem->>'item_number', '') IS NULL
       OR (elem->>'item_number')::int < 1
       OR NULLIF(elem->>'day_of_week', '') IS NULL
       OR (elem->>'day_of_week')::int NOT BETWEEN 1 AND 7
  ) THEN
    RAISE EXCEPTION 'HGV_SAVE:INVALID_ITEM';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(p_items) AS elem
    GROUP BY (elem->>'item_number')::int, (elem->>'day_of_week')::int
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'HGV_SAVE:INVALID_ITEM';
  END IF;

  SELECT *
  INTO v_row
  FROM public.hgv_inspections
  WHERE hgv_id = p_hgv_id
    AND user_id = p_subject_user_id
    AND inspection_date = p_inspection_date
  FOR UPDATE;

  IF FOUND THEN
    v_found := TRUE;
  ELSIF p_hint_inspection_id IS NOT NULL THEN
    SELECT *
    INTO v_row
    FROM public.hgv_inspections
    WHERE id = p_hint_inspection_id
    FOR UPDATE;

    IF FOUND
       AND v_row.status = 'draft'
       AND (
         v_row.user_id IS NOT DISTINCT FROM p_actor_id
         OR COALESCE(p_actor_can_manage_others, FALSE)
       ) THEN
      v_found := TRUE;
    ELSE
      v_found := FALSE;
    END IF;
  END IF;

  IF NOT v_found THEN
    IF p_subject_user_id IS DISTINCT FROM p_actor_id AND NOT COALESCE(p_actor_can_manage_others, FALSE) THEN
      RAISE EXCEPTION 'HGV_SAVE:FORBIDDEN_SUBJECT';
    END IF;

    BEGIN
      INSERT INTO public.hgv_inspections (
        hgv_id,
        user_id,
        inspection_date,
        inspection_end_date,
        current_mileage,
        status,
        inspector_comments,
        submitted_at,
        signature_data,
        signed_at,
        updated_at
      ) VALUES (
        p_hgv_id,
        p_subject_user_id,
        p_inspection_date,
        p_inspection_date,
        p_current_mileage,
        'draft',
        p_inspector_comments,
        NULL,
        NULL,
        NULL,
        v_now
      )
      RETURNING * INTO v_row;
    EXCEPTION
      WHEN unique_violation THEN
        SELECT *
        INTO v_row
        FROM public.hgv_inspections
        WHERE hgv_id = p_hgv_id
          AND user_id = p_subject_user_id
          AND inspection_date = p_inspection_date
        FOR UPDATE;

        IF NOT FOUND THEN
          RAISE;
        END IF;
    END;
  END IF;

  IF p_expected_owner_id IS NOT NULL
     AND v_row.user_id IS DISTINCT FROM p_expected_owner_id THEN
    RAISE EXCEPTION 'HGV_SAVE:OWNERSHIP_CHANGED';
  END IF;

  IF v_row.user_id IS DISTINCT FROM p_actor_id AND NOT COALESCE(p_actor_can_manage_others, FALSE) THEN
    RAISE EXCEPTION 'HGV_SAVE:FORBIDDEN_OWNER';
  END IF;

  IF p_subject_user_id IS DISTINCT FROM p_actor_id AND NOT COALESCE(p_actor_can_manage_others, FALSE) THEN
    RAISE EXCEPTION 'HGV_SAVE:FORBIDDEN_SUBJECT';
  END IF;

  IF v_row.status = 'submitted' THEN
    IF p_status = 'draft' THEN
      RAISE EXCEPTION 'HGV_SAVE:SUBMITTED_CONFLICT';
    END IF;

    SELECT jsonb_build_object(
      'id', v_row.id,
      'status', v_row.status,
      'items', COALESCE((
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', ii.id,
            'item_number', ii.item_number,
            'item_description', ii.item_description,
            'day_of_week', ii.day_of_week,
            'status', ii.status,
            'comments', ii.comments
          )
          ORDER BY ii.item_number
        )
        FROM public.inspection_items AS ii
        WHERE ii.inspection_id = v_row.id
      ), '[]'::jsonb)
    )
    INTO v_result;

    RETURN v_result;
  END IF;

  UPDATE public.hgv_inspections
  SET
    hgv_id = p_hgv_id,
    user_id = p_subject_user_id,
    inspection_date = p_inspection_date,
    inspection_end_date = p_inspection_date,
    current_mileage = p_current_mileage,
    inspector_comments = p_inspector_comments,
    updated_at = v_now
  WHERE id = v_row.id
    AND status = 'draft'
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'HGV_SAVE:OWNERSHIP_CHANGED';
  END IF;

  WITH incoming AS (
    SELECT
      (elem->>'item_number')::int AS item_number,
      NULLIF(elem->>'item_description', '') AS item_description,
      (elem->>'day_of_week')::int AS day_of_week,
      elem->>'status' AS status,
      NULLIF(elem->>'comments', '') AS comments
    FROM jsonb_array_elements(p_items) AS elem
  )
  UPDATE public.inspection_items AS ii
  SET
    item_description = incoming.item_description,
    status = incoming.status,
    comments = incoming.comments
  FROM incoming
  WHERE ii.inspection_id = v_row.id
    AND ii.item_number = incoming.item_number
    AND ii.day_of_week = incoming.day_of_week;

  INSERT INTO public.inspection_items (
    inspection_id,
    item_number,
    item_description,
    day_of_week,
    status,
    comments
  )
  SELECT
    v_row.id,
    incoming.item_number,
    incoming.item_description,
    incoming.day_of_week,
    incoming.status,
    incoming.comments
  FROM (
    SELECT
      (elem->>'item_number')::int AS item_number,
      NULLIF(elem->>'item_description', '') AS item_description,
      (elem->>'day_of_week')::int AS day_of_week,
      elem->>'status' AS status,
      NULLIF(elem->>'comments', '') AS comments
    FROM jsonb_array_elements(p_items) AS elem
  ) AS incoming
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.inspection_items AS ii
    WHERE ii.inspection_id = v_row.id
      AND ii.item_number = incoming.item_number
      AND ii.day_of_week = incoming.day_of_week
  );

  DELETE FROM public.inspection_items AS ii
  WHERE ii.inspection_id = v_row.id
    AND NOT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(p_items) AS elem
      WHERE (elem->>'item_number')::int = ii.item_number
        AND (elem->>'day_of_week')::int = ii.day_of_week
    );

  UPDATE public.actions AS a
  SET inspection_item_id = mapped.keeper_id
  FROM (
    SELECT
      extras.id AS extra_id,
      keepers.keeper_id
    FROM (
      SELECT
        id,
        item_number,
        day_of_week,
        ROW_NUMBER() OVER (
          PARTITION BY item_number, day_of_week
          ORDER BY id
        ) AS rn
      FROM public.inspection_items
      WHERE inspection_id = v_row.id
    ) AS extras
    INNER JOIN (
      SELECT
        id AS keeper_id,
        item_number,
        day_of_week
      FROM (
        SELECT
          id,
          item_number,
          day_of_week,
          ROW_NUMBER() OVER (
            PARTITION BY item_number, day_of_week
            ORDER BY id
          ) AS rn
        FROM public.inspection_items
        WHERE inspection_id = v_row.id
      ) AS keeper_ranked
      WHERE keeper_ranked.rn = 1
    ) AS keepers
      ON keepers.item_number = extras.item_number
     AND keepers.day_of_week = extras.day_of_week
    WHERE extras.rn > 1
  ) AS mapped
  WHERE a.inspection_item_id = mapped.extra_id;

  DELETE FROM public.inspection_items AS ii
  WHERE ii.id IN (
    SELECT ranked.id
    FROM (
      SELECT
        id,
        ROW_NUMBER() OVER (
          PARTITION BY item_number, day_of_week
          ORDER BY id
        ) AS rn
      FROM public.inspection_items
      WHERE inspection_id = v_row.id
    ) AS ranked
    WHERE ranked.rn > 1
  );

  IF p_status = 'submitted' THEN
    UPDATE public.hgv_inspections
    SET
      status = 'submitted',
      submitted_at = v_now,
      signature_data = p_signature_data,
      signed_at = CASE WHEN p_signature_data IS NOT NULL THEN v_now ELSE NULL END,
      current_mileage = p_current_mileage,
      updated_at = v_now
    WHERE id = v_row.id
      AND status = 'draft'
    RETURNING * INTO v_row;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'HGV_SAVE:SUBMITTED_CONFLICT';
    END IF;

    UPDATE public.hgvs
    SET current_mileage = p_current_mileage
    WHERE id = p_hgv_id;
  END IF;

  SELECT jsonb_build_object(
    'id', v_row.id,
    'status', v_row.status,
    'items', COALESCE((
      SELECT jsonb_agg(
        jsonb_build_object(
          'id', ii.id,
          'item_number', ii.item_number,
          'item_description', ii.item_description,
          'day_of_week', ii.day_of_week,
          'status', ii.status,
          'comments', ii.comments
        )
        ORDER BY ii.item_number
      )
      FROM public.inspection_items AS ii
      WHERE ii.inspection_id = v_row.id
    ), '[]'::jsonb)
  )
  INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.save_hgv_inspection(
  uuid,
  boolean,
  uuid,
  uuid,
  date,
  uuid,
  uuid,
  text,
  integer,
  text,
  text,
  jsonb
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.save_hgv_inspection(
  uuid,
  boolean,
  uuid,
  uuid,
  date,
  uuid,
  uuid,
  text,
  integer,
  text,
  text,
  jsonb
) TO service_role;

COMMIT;
