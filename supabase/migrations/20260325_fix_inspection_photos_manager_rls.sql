-- =============================================================================
-- Fix inspection_photos RLS: allow managers/admins to insert and delete
-- =============================================================================
-- The existing "Managers can view all inspection photos" policy only covers
-- SELECT. When a manager fills in an inspection on behalf of an employee,
-- the draft's user_id is the employee — not the manager — so the "Users can
-- manage own inspection photos" FOR ALL policy blocks the manager's INSERT
-- and DELETE operations.
--
-- Fix: replace the manager SELECT-only policy with a FOR ALL policy so
-- managers can upload and delete photos on any inspection.
-- =============================================================================

BEGIN;

DROP POLICY IF EXISTS "Managers can view all inspection photos" ON inspection_photos;
CREATE POLICY "Managers can manage all inspection photos" ON inspection_photos
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      JOIN roles r ON p.role_id = r.id
      WHERE p.id = auth.uid()
        AND r.is_manager_admin = true
    )
  );

COMMIT;
