-- The fleet category picker is also the source of eligible trailers for daily checks.
INSERT INTO public.hgv_categories (name, description)
VALUES ('Trailer', 'Trailers available to couple to an HGV tractor unit')
ON CONFLICT (name) DO NOTHING;

UPDATE public.hgvs
SET category_id = (SELECT id FROM public.hgv_categories WHERE name = 'Trailer')
WHERE upper(regexp_replace(reg_number, '\s+', '', 'g')) = 'C517773'
  AND category_id IS DISTINCT FROM (SELECT id FROM public.hgv_categories WHERE name = 'Trailer');

-- The category's name is used by both the picker and the transactional save.
CREATE FUNCTION public.guard_hgv_trailer_category() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF OLD.name = 'Trailer' AND (TG_OP = 'DELETE' OR NEW.name IS DISTINCT FROM OLD.name) THEN
    RAISE EXCEPTION 'The Trailer category is used by HGV Daily Checks' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER protect_hgv_trailer_category
BEFORE DELETE OR UPDATE OF name ON public.hgv_categories
FOR EACH ROW EXECUTE FUNCTION public.guard_hgv_trailer_category();
