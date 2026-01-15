-- Migration: Add 'on_hold' status to actions table
-- Date: 2026-01-15
-- Purpose: Add new status for workshop tasks that are waiting/paused

-- Drop existing constraint
ALTER TABLE actions DROP CONSTRAINT IF EXISTS actions_status_check;

-- Add new constraint with 'on_hold' included
ALTER TABLE actions ADD CONSTRAINT actions_status_check
  CHECK (status IN ('pending', 'in_progress', 'logged', 'on_hold', 'completed'));
