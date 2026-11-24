-- Read through the same row policies as the original fleet history. No copied checks.
CREATE FUNCTION public.hgv_asset_daily_checks(p_asset_id uuid, p_offset integer DEFAULT 0)
RETURNS TABLE (
  id uuid, inspection_id uuid, inspection_date date, submitted_at timestamptz,
  record_kind text, current_mileage integer, driver_name text, defect_count integer,
  entry_kind text, tractor_registration text, trailer_label text
)
LANGUAGE sql STABLE SECURITY INVOKER SET search_path = '' AS $$
  WITH entries AS (
    SELECT i.id, i.id AS inspection_id, i.inspection_date, i.submitted_at,
           i.record_kind::text, CASE WHEN i.hgv_id = p_asset_id THEN i.current_mileage END AS mileage,
           i.user_id, i.hgv_id, i.trailer_label,
           CASE WHEN i.hgv_id = p_asset_id THEN 'tractor' ELSE 'trailer' END AS entry_kind,
           NULL::jsonb AS swap_items
    FROM public.hgv_inspections i
    WHERE i.status = 'submitted' AND (i.hgv_id = p_asset_id OR (i.trailer_hgv_id = p_asset_id AND
      (i.record_kind = 'full_check' OR EXISTS (
        SELECT FROM public.inspection_items item WHERE item.inspection_id=i.id AND
          lower(trim(item.item_description)) IN ('brake hoses', 'couplings secure', 'electrical connections', 'trailer no. plate')
      ))))
    UNION ALL
    SELECT s.id, i.id, (s.created_at AT TIME ZONE 'Europe/London')::date, s.created_at,
           'full_check', NULL, s.user_id, s.hgv_id, s.trailer_label, 'swap', s.items
    FROM public.hgv_trailer_swaps s
    JOIN public.hgv_inspections i ON i.id = s.parent_check_id
    WHERE i.status = 'submitted' AND (s.hgv_id = p_asset_id OR s.trailer_hgv_id = p_asset_id)
  ), page AS (
    SELECT * FROM entries ORDER BY inspection_date DESC, submitted_at DESC NULLS LAST, id DESC
    OFFSET greatest(p_offset, 0) LIMIT 50
  )
  SELECT e.id, e.inspection_id, e.inspection_date, e.submitted_at, e.record_kind,
         e.mileage, p.full_name::text,
         CASE WHEN e.entry_kind = 'swap' THEN (
           SELECT count(*)::integer FROM jsonb_array_elements(e.swap_items) item
           WHERE item->>'status' IN ('attention', 'defect')
         ) ELSE (
           SELECT count(*)::integer FROM public.inspection_items item
           WHERE item.inspection_id = e.inspection_id AND item.status IN ('attention', 'defect')
             AND (e.entry_kind = 'tractor' OR lower(trim(item.item_description)) IN
                 ('brake hoses', 'couplings secure', 'electrical connections', 'trailer no. plate'))
         ) END, e.entry_kind, h.reg_number::text, e.trailer_label
  FROM page e
  LEFT JOIN public.profiles p ON p.id = e.user_id
  LEFT JOIN public.hgvs h ON h.id = e.hgv_id
  ORDER BY e.inspection_date DESC, e.submitted_at DESC NULLS LAST, e.id DESC;
$$;
REVOKE ALL ON FUNCTION public.hgv_asset_daily_checks(uuid, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.hgv_asset_daily_checks(uuid, integer) TO authenticated, service_role;
