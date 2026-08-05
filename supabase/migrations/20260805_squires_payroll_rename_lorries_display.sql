-- Display name only: keep rule_key = 'lorries' for stable assignment keys.
UPDATE public.payroll_rule_sets
SET name = 'Transport',
    updated_at = NOW()
WHERE rule_key = 'lorries'
  AND name IS DISTINCT FROM 'Transport';
