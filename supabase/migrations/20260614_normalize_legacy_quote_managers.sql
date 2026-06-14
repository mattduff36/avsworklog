BEGIN;

UPDATE public.legacy_quotes
SET quote_manager_name = 'George Healey',
    quote_manager_initials = 'GH',
    updated_at = NOW()
WHERE lower(regexp_replace(coalesce(quote_manager_name, ''), '\s+', ' ', 'g')) IN ('geroge healey', 'george healey');

COMMIT;
