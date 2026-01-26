-- Migration: Fix Workshop Attachment Question Deletion Cascade
-- Date: 2026-01-22
-- Purpose: Allow deletion of questions that have responses by cascading deletes
-- Issue: Foreign key constraint violation when deleting questions with responses

BEGIN;

-- Drop the existing foreign key constraint
ALTER TABLE workshop_attachment_responses
  DROP CONSTRAINT IF EXISTS workshop_attachment_responses_question_id_fkey;

-- Recreate with ON DELETE CASCADE
-- This will automatically delete all responses when a question is deleted
ALTER TABLE workshop_attachment_responses
  ADD CONSTRAINT workshop_attachment_responses_question_id_fkey
  FOREIGN KEY (question_id)
  REFERENCES workshop_attachment_questions(id)
  ON DELETE CASCADE;

COMMIT;

-- Verification
DO $$
DECLARE
  constraint_def TEXT;
BEGIN
  RAISE NOTICE '';
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE '✅ Workshop Attachment Cascade Delete Fixed!';
  RAISE NOTICE '';
  
  -- Verify the constraint now has ON DELETE CASCADE
  SELECT pg_get_constraintdef(oid) INTO constraint_def
  FROM pg_constraint
  WHERE conname = 'workshop_attachment_responses_question_id_fkey';
  
  IF constraint_def LIKE '%ON DELETE CASCADE%' THEN
    RAISE NOTICE '✓ Foreign key constraint updated with ON DELETE CASCADE';
    RAISE NOTICE '✓ Deleting a question will now automatically delete its responses';
  ELSE
    RAISE WARNING 'Constraint may not have CASCADE DELETE - manual verification needed';
  END IF;
  
  RAISE NOTICE '';
  RAISE NOTICE 'Impact:';
  RAISE NOTICE '  • Users can now delete attachment questions';
  RAISE NOTICE '  • Associated responses will be automatically deleted';
  RAISE NOTICE '  • No more foreign key constraint violations';
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE '';
END $$;
