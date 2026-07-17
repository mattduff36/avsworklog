BEGIN;

CREATE SEQUENCE IF NOT EXISTS public.quote_financial_adjustment_number_seq;

CREATE TABLE IF NOT EXISTS public.quote_financial_adjustments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  adjustment_number TEXT NOT NULL UNIQUE DEFAULT (
    'ADJ-' || to_char(CURRENT_DATE, 'YYYY') || '-' ||
    lpad(nextval('public.quote_financial_adjustment_number_seq')::TEXT, 6, '0')
  ),
  quote_thread_id UUID NOT NULL,
  quote_id UUID NOT NULL REFERENCES public.quotes(id) ON DELETE RESTRICT,
  invoice_id UUID REFERENCES public.quote_invoices(id) ON DELETE RESTRICT,
  related_adjustment_id UUID REFERENCES public.quote_financial_adjustments(id) ON DELETE RESTRICT,
  reverses_adjustment_id UUID REFERENCES public.quote_financial_adjustments(id) ON DELETE RESTRICT,
  adjustment_type TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  direction TEXT,
  effective_date DATE NOT NULL DEFAULT CURRENT_DATE,
  reason TEXT NOT NULL,
  notes TEXT,
  external_reference TEXT,
  metadata_before JSONB NOT NULL DEFAULT '{}'::JSONB,
  metadata_after JSONB NOT NULL DEFAULT '{}'::JSONB,
  document_snapshot JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT quote_financial_adjustments_type_check CHECK (
    adjustment_type IN (
      'credit_note',
      'refund',
      'debit_adjustment',
      'quote_value_adjustment',
      'invoice_metadata_correction',
      'write_off',
      'invoice_void',
      'reversal'
    )
  ),
  CONSTRAINT quote_financial_adjustments_amount_check CHECK (amount >= 0),
  CONSTRAINT quote_financial_adjustments_direction_check CHECK (
    direction IS NULL OR direction IN ('increase', 'decrease')
  ),
  CONSTRAINT quote_financial_adjustments_reason_check CHECK (length(btrim(reason)) > 0),
  CONSTRAINT quote_financial_adjustments_target_check CHECK (
    (
      adjustment_type IN (
        'credit_note',
        'refund',
        'debit_adjustment',
        'invoice_metadata_correction',
        'invoice_void'
      )
      AND invoice_id IS NOT NULL
    )
    OR (
      adjustment_type IN ('quote_value_adjustment', 'write_off')
      AND invoice_id IS NULL
    )
    OR adjustment_type = 'reversal'
  ),
  CONSTRAINT quote_financial_adjustments_value_check CHECK (
    (adjustment_type = 'invoice_metadata_correction' AND amount = 0)
    OR (adjustment_type = 'reversal' AND amount >= 0)
    OR (
      adjustment_type NOT IN ('invoice_metadata_correction', 'reversal')
      AND amount > 0
    )
  ),
  CONSTRAINT quote_financial_adjustments_quote_direction_check CHECK (
    (adjustment_type = 'quote_value_adjustment' AND direction IS NOT NULL)
    OR (adjustment_type <> 'quote_value_adjustment' AND direction IS NULL)
  ),
  CONSTRAINT quote_financial_adjustments_refund_link_check CHECK (
    (adjustment_type = 'refund' AND related_adjustment_id IS NOT NULL)
    OR adjustment_type <> 'refund'
  ),
  CONSTRAINT quote_financial_adjustments_reversal_link_check CHECK (
    (adjustment_type = 'reversal' AND reverses_adjustment_id IS NOT NULL)
    OR (adjustment_type <> 'reversal' AND reverses_adjustment_id IS NULL)
  )
);

ALTER TABLE public.quote_financial_adjustments
  DROP CONSTRAINT IF EXISTS quote_financial_adjustments_value_check;
ALTER TABLE public.quote_financial_adjustments
  ADD CONSTRAINT quote_financial_adjustments_value_check CHECK (
    (adjustment_type = 'invoice_metadata_correction' AND amount = 0)
    OR (adjustment_type = 'reversal' AND amount >= 0)
    OR (
      adjustment_type NOT IN ('invoice_metadata_correction', 'reversal')
      AND amount > 0
    )
  );

COMMENT ON TABLE public.quote_financial_adjustments IS
  'Append-only manual Sage reconciliation ledger for quote versions and invoices (FIN-ADJ-001).';
COMMENT ON COLUMN public.quote_financial_adjustments.document_snapshot IS
  'Immutable data snapshot used to render the reference-only Adjustment Record PDF.';

CREATE INDEX IF NOT EXISTS idx_quote_financial_adjustments_thread_created
  ON public.quote_financial_adjustments(quote_thread_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quote_financial_adjustments_quote_effective
  ON public.quote_financial_adjustments(quote_id, effective_date DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_quote_financial_adjustments_invoice
  ON public.quote_financial_adjustments(invoice_id, created_at DESC)
  WHERE invoice_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_quote_financial_adjustments_external_reference
  ON public.quote_financial_adjustments(external_reference)
  WHERE external_reference IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_quote_financial_adjustments_one_reversal
  ON public.quote_financial_adjustments(reverses_adjustment_id)
  WHERE reverses_adjustment_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_quote_financial_adjustment_append_only()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.effective_date > CURRENT_DATE THEN
      RAISE EXCEPTION 'Financial adjustment effective date cannot be in the future';
    END IF;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Financial adjustments are append-only; create a reversal instead';
END;
$$;

DROP TRIGGER IF EXISTS enforce_quote_financial_adjustment_append_only
  ON public.quote_financial_adjustments;
CREATE TRIGGER enforce_quote_financial_adjustment_append_only
  BEFORE INSERT OR UPDATE OR DELETE ON public.quote_financial_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_quote_financial_adjustment_append_only();

ALTER TABLE public.quote_financial_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS quote_financial_adjustments_select
  ON public.quote_financial_adjustments;
CREATE POLICY quote_financial_adjustments_select
  ON public.quote_financial_adjustments
  FOR SELECT
  TO authenticated
  USING ((SELECT public.effective_has_module_permission('quotes')));

REVOKE ALL ON public.quote_financial_adjustments FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.quote_financial_adjustments FROM authenticated;
GRANT SELECT ON public.quote_financial_adjustments TO authenticated;
GRANT ALL ON public.quote_financial_adjustments TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.quote_financial_adjustment_number_seq TO service_role;

COMMIT;
