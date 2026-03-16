-- =============================================================================
-- Fix inspection photo storage RLS policies
-- =============================================================================
-- Ensures authenticated users can upload/delete in the inspection-photos bucket
-- and keeps read access available for bucket objects.

BEGIN;

DROP POLICY IF EXISTS "Users can upload inspection photos" ON storage.objects;
CREATE POLICY "Users can upload inspection photos" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'inspection-photos'
    AND auth.uid() IS NOT NULL
  );

DROP POLICY IF EXISTS "Anyone can view inspection photos" ON storage.objects;
CREATE POLICY "Anyone can view inspection photos" ON storage.objects
  FOR SELECT TO public
  USING (
    bucket_id = 'inspection-photos'
  );

DROP POLICY IF EXISTS "Users can delete own inspection photos" ON storage.objects;
CREATE POLICY "Users can delete own inspection photos" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'inspection-photos'
    AND auth.uid() IS NOT NULL
  );

COMMIT;
