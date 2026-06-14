BEGIN;

WITH normalized AS (
  SELECT
    id,
    NULLIF(BTRIM(COALESCE(raw_data ->> 'Quote Value / Total Amount', '')), '') AS csv_total_text
  FROM public.legacy_quotes
)
UPDATE public.legacy_quotes AS legacy
SET quote_value_text = normalized.csv_total_text,
    quote_value_amount = CASE
      WHEN normalized.csv_total_text IS NULL THEN NULL
      WHEN normalized.csv_total_text ~* '(rates?|various|#?\s*n\s*/?\s*a)' THEN NULL
      WHEN BTRIM(REGEXP_REPLACE(normalized.csv_total_text, '[£,]', '', 'g')) ~ '^\d+(\.\d{1,2})?$'
        THEN BTRIM(REGEXP_REPLACE(normalized.csv_total_text, '[£,]', '', 'g'))::numeric
      ELSE NULL
    END,
    updated_at = NOW()
FROM normalized
WHERE legacy.id = normalized.id;

COMMIT;
