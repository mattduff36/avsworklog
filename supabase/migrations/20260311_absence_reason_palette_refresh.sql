BEGIN;

UPDATE absence_reasons
SET color = CASE lower(name)
  WHEN 'annual leave' THEN '#7c3aed'
  WHEN 'unpaid leave' THEN '#334155'
  WHEN 'sickness' THEN '#dc2626'
  WHEN 'maternity leave' THEN '#db2777'
  WHEN 'paternity leave' THEN '#2563eb'
  WHEN 'public duties' THEN '#0f766e'
  WHEN 'dependant emergency' THEN '#ea580c'
  WHEN 'medical appointment' THEN '#0891b2'
  WHEN 'parental leave' THEN '#16a34a'
  WHEN 'bereavement' THEN '#4f46e5'
  WHEN 'sabbatical' THEN '#9333ea'
  ELSE color
END
WHERE lower(name) IN (
  'annual leave',
  'unpaid leave',
  'sickness',
  'maternity leave',
  'paternity leave',
  'public duties',
  'dependant emergency',
  'medical appointment',
  'parental leave',
  'bereavement',
  'sabbatical'
);

COMMIT;
