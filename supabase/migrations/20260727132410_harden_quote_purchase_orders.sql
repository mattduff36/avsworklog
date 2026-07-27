-- Harden the quote purchase-order ledger after the initial multi-PO rollout.
-- This migration preserves thread history, repairs missed backfills, and
-- removes orphanable quote-line coverage rows.

ALTER TABLE public.quote_purchase_orders
  DROP CONSTRAINT IF EXISTS quote_purchase_orders_quote_id_fkey;

ALTER TABLE public.quote_purchase_orders
  ADD CONSTRAINT quote_purchase_orders_quote_id_fkey
  FOREIGN KEY (quote_id)
  REFERENCES public.quotes(id)
  ON DELETE RESTRICT;

DELETE FROM public.quote_purchase_order_lines
WHERE quote_line_item_id IS NULL;

ALTER TABLE public.quote_purchase_order_lines
  ALTER COLUMN quote_line_item_id SET NOT NULL;

ALTER TABLE public.quote_purchase_order_lines
  DROP CONSTRAINT IF EXISTS quote_purchase_order_lines_quote_line_item_id_fkey;

ALTER TABLE public.quote_purchase_order_lines
  ADD CONSTRAINT quote_purchase_order_lines_quote_line_item_id_fkey
  FOREIGN KEY (quote_line_item_id)
  REFERENCES public.quote_line_items(id)
  ON DELETE CASCADE;

CREATE OR REPLACE FUNCTION public.validate_quote_purchase_order_thread()
RETURNS TRIGGER AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.quotes q
    WHERE q.quote_thread_id = NEW.quote_thread_id
  ) THEN
    RAISE EXCEPTION 'Quote thread % does not exist', NEW.quote_thread_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

DROP TRIGGER IF EXISTS quote_purchase_orders_validate_thread_trigger
  ON public.quote_purchase_orders;
CREATE TRIGGER quote_purchase_orders_validate_thread_trigger
BEFORE INSERT OR UPDATE OF quote_thread_id ON public.quote_purchase_orders
FOR EACH ROW EXECUTE FUNCTION public.validate_quote_purchase_order_thread();

-- The original migration preferred the latest version even when its PO fields
-- were empty. Backfill any missed thread from its newest version containing PO
-- data, without duplicating threads already represented in the ledger.
WITH preferred_sources AS (
  SELECT DISTINCT ON (q.quote_thread_id)
    q.quote_thread_id,
    q.id AS quote_id,
    COALESCE(NULLIF(TRIM(q.po_number), ''), 'Unnumbered PO') AS po_number,
    q.po_value,
    COALESCE(q.po_received_at, q.updated_at, q.created_at, NOW()) AS received_at,
    q.created_by
  FROM public.quotes q
  WHERE q.po_number IS NOT NULL OR q.po_value IS NOT NULL
  ORDER BY
    q.quote_thread_id,
    q.is_latest_version DESC,
    q.created_at DESC
)
INSERT INTO public.quote_purchase_orders (
  quote_thread_id,
  quote_id,
  po_number,
  po_value,
  received_at,
  created_by
)
SELECT
  source.quote_thread_id,
  source.quote_id,
  source.po_number,
  source.po_value,
  source.received_at,
  source.created_by
FROM preferred_sources source
WHERE NOT EXISTS (
  SELECT 1
  FROM public.quote_purchase_orders existing
  WHERE existing.quote_thread_id = source.quote_thread_id
);

-- Recompute every quote-thread rollup. SUM preserves NULL when all PO values
-- are unknown, rather than reporting a misleading zero.
WITH rollups AS (
  SELECT
    thread.quote_thread_id,
    (
      SELECT first_po.po_number
      FROM public.quote_purchase_orders first_po
      WHERE first_po.quote_thread_id = thread.quote_thread_id
      ORDER BY first_po.received_at ASC, first_po.created_at ASC
      LIMIT 1
    ) AS po_number,
    (
      SELECT SUM(value_po.po_value)
      FROM public.quote_purchase_orders value_po
      WHERE value_po.quote_thread_id = thread.quote_thread_id
    ) AS po_value,
    (
      SELECT MIN(date_po.received_at)
      FROM public.quote_purchase_orders date_po
      WHERE date_po.quote_thread_id = thread.quote_thread_id
    ) AS po_received_at
  FROM (
    SELECT DISTINCT q.quote_thread_id
    FROM public.quotes q
  ) thread
)
UPDATE public.quotes q
SET
  po_number = rollups.po_number,
  po_value = rollups.po_value,
  po_received_at = rollups.po_received_at
FROM rollups
WHERE q.quote_thread_id = rollups.quote_thread_id;
