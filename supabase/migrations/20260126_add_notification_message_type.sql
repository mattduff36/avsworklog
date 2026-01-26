-- Migration: Add NOTIFICATION message type
-- Date: 2026-01-26
--
-- Purpose: Separate non-toolbox notifications (errors, maintenance, etc.) from
-- toolbox talks and reminders, so the toolbox-talks Reports tab only shows
-- messages created from that page.

-- ============================================================================
-- Add NOTIFICATION to messages.type check constraint
-- ============================================================================

-- Drop existing check constraint
ALTER TABLE messages DROP CONSTRAINT IF EXISTS messages_type_check;

-- Add new constraint with NOTIFICATION type
ALTER TABLE messages 
  ADD CONSTRAINT messages_type_check 
  CHECK (type IN ('TOOLBOX_TALK', 'REMINDER', 'NOTIFICATION'));

-- ============================================================================
-- Verification
-- ============================================================================

DO $$ 
BEGIN
  RAISE NOTICE 'Message types now support: TOOLBOX_TALK, REMINDER, NOTIFICATION';
END $$;

-- ============================================================================
-- End of migration
-- ============================================================================
