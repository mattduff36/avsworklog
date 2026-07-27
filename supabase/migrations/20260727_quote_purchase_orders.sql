-- Multi-PO ledger for quotes (thread-scoped) with optional quote-line coverage ticks.
-- Keeps quotes.po_number / po_value / po_received_at as denormalized rollups.

CREATE TABLE IF NOT EXISTS public.quote_purchase_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_thread_id UUID NOT NULL,
  quote_id UUID NOT NULL REFERENCES public.quotes(id) ON DELETE CASCADE,
  po_number VARCHAR(100) NOT NULL,
  po_value NUMERIC(12,2),
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  notes TEXT,
  created_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.quote_purchase_orders IS 'Purchase order history for quote threads; multiple POs per quote.';

CREATE INDEX IF NOT EXISTS idx_quote_purchase_orders_thread_received
  ON public.quote_purchase_orders(quote_thread_id, received_at DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_quote_purchase_orders_quote_id
  ON public.quote_purchase_orders(quote_id);

CREATE INDEX IF NOT EXISTS idx_quote_purchase_orders_po_number
  ON public.quote_purchase_orders(po_number);

CREATE TABLE IF NOT EXISTS public.quote_purchase_order_lines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_purchase_order_id UUID NOT NULL REFERENCES public.quote_purchase_orders(id) ON DELETE CASCADE,
  quote_line_item_id UUID REFERENCES public.quote_line_items(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE public.quote_purchase_order_lines IS 'Quote line coverage ticks for a purchase order (presence = covered).';

CREATE UNIQUE INDEX IF NOT EXISTS uq_quote_purchase_order_lines_po_line
  ON public.quote_purchase_order_lines(quote_purchase_order_id, quote_line_item_id)
  WHERE quote_line_item_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_quote_purchase_order_lines_po_id
  ON public.quote_purchase_order_lines(quote_purchase_order_id);

CREATE INDEX IF NOT EXISTS idx_quote_purchase_order_lines_line_id
  ON public.quote_purchase_order_lines(quote_line_item_id);

CREATE OR REPLACE FUNCTION public.update_quote_purchase_orders_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS quote_purchase_orders_updated_at_trigger ON public.quote_purchase_orders;
CREATE TRIGGER quote_purchase_orders_updated_at_trigger
BEFORE UPDATE ON public.quote_purchase_orders
FOR EACH ROW EXECUTE FUNCTION public.update_quote_purchase_orders_updated_at();

ALTER TABLE public.quote_purchase_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_purchase_order_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quote_purchase_orders_select ON public.quote_purchase_orders;
CREATE POLICY quote_purchase_orders_select ON public.quote_purchase_orders
  FOR SELECT USING (effective_is_manager_admin());

DROP POLICY IF EXISTS quote_purchase_orders_insert ON public.quote_purchase_orders;
CREATE POLICY quote_purchase_orders_insert ON public.quote_purchase_orders
  FOR INSERT WITH CHECK (effective_is_manager_admin());

DROP POLICY IF EXISTS quote_purchase_orders_update ON public.quote_purchase_orders;
CREATE POLICY quote_purchase_orders_update ON public.quote_purchase_orders
  FOR UPDATE USING (effective_is_manager_admin())
  WITH CHECK (effective_is_manager_admin());

DROP POLICY IF EXISTS quote_purchase_orders_delete ON public.quote_purchase_orders;
CREATE POLICY quote_purchase_orders_delete ON public.quote_purchase_orders
  FOR DELETE USING (effective_is_manager_admin());

DROP POLICY IF EXISTS quote_purchase_order_lines_select ON public.quote_purchase_order_lines;
CREATE POLICY quote_purchase_order_lines_select ON public.quote_purchase_order_lines
  FOR SELECT USING (effective_is_manager_admin());

DROP POLICY IF EXISTS quote_purchase_order_lines_insert ON public.quote_purchase_order_lines;
CREATE POLICY quote_purchase_order_lines_insert ON public.quote_purchase_order_lines
  FOR INSERT WITH CHECK (effective_is_manager_admin());

DROP POLICY IF EXISTS quote_purchase_order_lines_update ON public.quote_purchase_order_lines;
CREATE POLICY quote_purchase_order_lines_update ON public.quote_purchase_order_lines
  FOR UPDATE USING (effective_is_manager_admin())
  WITH CHECK (effective_is_manager_admin());

DROP POLICY IF EXISTS quote_purchase_order_lines_delete ON public.quote_purchase_order_lines;
CREATE POLICY quote_purchase_order_lines_delete ON public.quote_purchase_order_lines
  FOR DELETE USING (effective_is_manager_admin());

-- Backfill one PO row per thread that already has denormalized PO fields.
WITH thread_candidates AS (
  SELECT
    q.quote_thread_id,
    COALESCE(
      (
        SELECT latest.id
        FROM public.quotes latest
        WHERE latest.quote_thread_id = q.quote_thread_id
          AND latest.is_latest_version = true
        ORDER BY latest.created_at DESC
        LIMIT 1
      ),
      (
        SELECT any_version.id
        FROM public.quotes any_version
        WHERE any_version.quote_thread_id = q.quote_thread_id
          AND (any_version.po_number IS NOT NULL OR any_version.po_value IS NOT NULL)
        ORDER BY any_version.created_at DESC
        LIMIT 1
      )
    ) AS preferred_quote_id
  FROM public.quotes q
  WHERE q.po_number IS NOT NULL OR q.po_value IS NOT NULL
  GROUP BY q.quote_thread_id
),
source_rows AS (
  SELECT
    tc.quote_thread_id,
    q.id AS quote_id,
    COALESCE(NULLIF(TRIM(q.po_number), ''), 'Unnumbered PO') AS po_number,
    q.po_value,
    COALESCE(q.po_received_at, q.updated_at, q.created_at, NOW()) AS received_at,
    q.created_by
  FROM thread_candidates tc
  JOIN public.quotes q ON q.id = tc.preferred_quote_id
  WHERE q.po_number IS NOT NULL OR q.po_value IS NOT NULL
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
  sr.quote_thread_id,
  sr.quote_id,
  sr.po_number,
  sr.po_value,
  sr.received_at,
  sr.created_by
FROM source_rows sr
WHERE NOT EXISTS (
  SELECT 1
  FROM public.quote_purchase_orders existing
  WHERE existing.quote_thread_id = sr.quote_thread_id
);

-- Recompute denormalized rollups from the ledger for every thread that has POs.
WITH rollups AS (
  SELECT
    po.quote_thread_id,
    (
      SELECT first_po.po_number
      FROM public.quote_purchase_orders first_po
      WHERE first_po.quote_thread_id = po.quote_thread_id
      ORDER BY first_po.received_at ASC, first_po.created_at ASC
      LIMIT 1
    ) AS po_number,
    SUM(COALESCE(po.po_value, 0)) AS po_value,
    MIN(po.received_at) AS po_received_at
  FROM public.quote_purchase_orders po
  GROUP BY po.quote_thread_id
)
UPDATE public.quotes q
SET
  po_number = rollups.po_number,
  po_value = rollups.po_value,
  po_received_at = rollups.po_received_at
FROM rollups
WHERE q.quote_thread_id = rollups.quote_thread_id;
