-- Migration: Remove legacy workshop attachment questions/responses (V2 cutover)
-- Date: 2026-04-01
-- Purpose: Enforce V2-only attachments by dropping legacy question/response tables.

-- Safety gate: V2 response table must exist before legacy removal.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'workshop_attachment_field_responses'
  ) THEN
    RAISE EXCEPTION 'V2 table workshop_attachment_field_responses is missing. Abort legacy cutover.';
  END IF;
END $$;

-- Drop legacy triggers/functions.
DROP TRIGGER IF EXISTS set_workshop_attachment_responses_updated_at ON workshop_attachment_responses;
DROP FUNCTION IF EXISTS update_workshop_attachment_responses_updated_at();
DROP TRIGGER IF EXISTS set_workshop_attachment_questions_updated_at ON workshop_attachment_questions;
DROP FUNCTION IF EXISTS update_workshop_attachment_questions_updated_at();

-- Drop legacy policies.
DROP POLICY IF EXISTS "Authenticated users can read questions" ON workshop_attachment_questions;
DROP POLICY IF EXISTS "Managers and admins can create questions" ON workshop_attachment_questions;
DROP POLICY IF EXISTS "Managers and admins can update questions" ON workshop_attachment_questions;
DROP POLICY IF EXISTS "Managers and admins can delete questions" ON workshop_attachment_questions;

DROP POLICY IF EXISTS "Workshop users can read attachment responses" ON workshop_attachment_responses;
DROP POLICY IF EXISTS "Workshop users can create attachment responses" ON workshop_attachment_responses;
DROP POLICY IF EXISTS "Workshop users can update attachment responses" ON workshop_attachment_responses;
DROP POLICY IF EXISTS "Managers and admins can delete attachment responses" ON workshop_attachment_responses;

-- Drop legacy indexes (table drops also cascade these, but explicit for clarity).
DROP INDEX IF EXISTS idx_workshop_attachment_responses_attachment;
DROP INDEX IF EXISTS idx_workshop_attachment_responses_question;
DROP INDEX IF EXISTS idx_workshop_attachment_responses_unique;
DROP INDEX IF EXISTS idx_workshop_attachment_questions_template;

-- Drop legacy tables.
DROP TABLE IF EXISTS workshop_attachment_responses;
DROP TABLE IF EXISTS workshop_attachment_questions;

-- Drop legacy enum type after table removal.
DROP TYPE IF EXISTS workshop_question_type;
