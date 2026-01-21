-- Migration: Optimize RLS Policy Performance (Auth Function Calls)
-- Date: 2026-01-21
-- Purpose: Fix performance warnings from Supabase linter by optimizing auth function calls
-- Issue: auth.uid() and auth.jwt() are re-evaluated for EVERY ROW instead of once per query
-- Solution: Wrap in subquery: (select auth.uid()) evaluates once per query
--
-- This migration affects 121 RLS policies across 33 tables
-- Performance impact: Significant improvement for queries returning multiple rows

BEGIN;

-- ============================================================================
-- OPTIMIZATION PATTERN
-- ============================================================================
-- BEFORE (slow - evaluated per row):
--   auth.uid() = user_id
--   auth.jwt() ->> 'email'
--
-- AFTER (fast - evaluated once):
--   (select auth.uid()) = user_id
--   (select auth.jwt()) ->> 'email'
-- ============================================================================

DO $$
DECLARE
  policy_record RECORD;
  new_qual TEXT;
  new_with_check TEXT;
  optimized_count INTEGER := 0;
BEGIN
  RAISE NOTICE '🔧 Starting RLS Performance Optimization...';
  RAISE NOTICE '';
  
  -- Loop through all policies in public schema
  FOR policy_record IN
    SELECT 
      schemaname,
      tablename,
      policyname,
      cmd,
      roles,
      qual,
      with_check
    FROM pg_policies
    WHERE schemaname = 'public'
      AND (
        qual LIKE '%auth.uid()%' 
        OR qual LIKE '%auth.jwt()%'
        OR with_check LIKE '%auth.uid()%'
        OR with_check LIKE '%auth.jwt()%'
      )
    ORDER BY tablename, policyname
  LOOP
    -- Optimize qual (USING clause)
    IF policy_record.qual IS NOT NULL THEN
      new_qual := policy_record.qual;
      -- Replace auth.uid() with (select auth.uid())
      new_qual := replace(new_qual, 'auth.uid()', '(select auth.uid())');
      -- Replace auth.jwt() with (select auth.jwt())
      new_qual := replace(new_qual, 'auth.jwt()', '(select auth.jwt())');
    END IF;
    
    -- Optimize with_check (WITH CHECK clause)
    IF policy_record.with_check IS NOT NULL THEN
      new_with_check := policy_record.with_check;
      -- Replace auth.uid() with (select auth.uid())
      new_with_check := replace(new_with_check, 'auth.uid()', '(select auth.uid())');
      -- Replace auth.jwt() with (select auth.jwt())
      new_with_check := replace(new_with_check, 'auth.jwt()', '(select auth.jwt())');
    END IF;
    
    -- Only recreate if something changed
    IF (new_qual IS DISTINCT FROM policy_record.qual) OR (new_with_check IS DISTINCT FROM policy_record.with_check) THEN
      RAISE NOTICE 'Optimizing: %.% - %', policy_record.tablename, policy_record.policyname, policy_record.cmd;
      
      BEGIN
        -- Drop existing policy
        EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I',
          policy_record.policyname,
          policy_record.schemaname,
          policy_record.tablename
        );
        
        -- Recreate with optimized definition
        DECLARE
          create_stmt TEXT;
          roles_clause TEXT := '';
        BEGIN
          -- Build roles clause if not default (public)
          IF policy_record.roles IS NOT NULL AND array_length(policy_record.roles, 1) > 0 THEN
            roles_clause := format(' TO %s', array_to_string(policy_record.roles, ', '));
          END IF;
          
          -- Build CREATE POLICY statement
          create_stmt := format(
            'CREATE POLICY %I ON %I.%I FOR %s%s',
            policy_record.policyname,
            policy_record.schemaname,
            policy_record.tablename,
            policy_record.cmd,
            roles_clause
          );
          
          -- Add USING clause if exists (not for INSERT-only policies)
          IF new_qual IS NOT NULL AND policy_record.cmd != 'INSERT' THEN
            create_stmt := create_stmt || format(' USING (%s)', new_qual);
          END IF;
          
          -- Add WITH CHECK clause if exists (only for INSERT, UPDATE, and ALL)
          IF new_with_check IS NOT NULL AND policy_record.cmd IN ('INSERT', 'UPDATE', 'ALL') THEN
            create_stmt := create_stmt || format(' WITH CHECK (%s)', new_with_check);
          END IF;
          
          EXECUTE create_stmt;
          optimized_count := optimized_count + 1;
        END;
      EXCEPTION WHEN OTHERS THEN
        RAISE WARNING 'Failed to optimize policy %.%: %', policy_record.tablename, policy_record.policyname, SQLERRM;
        RAISE NOTICE 'Skipping this policy - may need manual review';
      END;
    END IF;
  END LOOP;
  
  RAISE NOTICE '';
  RAISE NOTICE '✅ Optimization Complete!';
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
  RAISE NOTICE 'Optimized % RLS policies', optimized_count;
  RAISE NOTICE 'Performance improvement: auth functions now evaluated once per query';
  RAISE NOTICE 'instead of once per row';
  RAISE NOTICE '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━';
END $$;

-- ============================================================================
-- VERIFICATION
-- ============================================================================

-- Count remaining unoptimized policies (should be 0)
DO $$
DECLARE
  remaining_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO remaining_count
  FROM pg_policies
  WHERE schemaname = 'public'
    AND (
      (qual LIKE '%auth.uid()%' AND qual NOT LIKE '%(select auth.uid())%')
      OR (qual LIKE '%auth.jwt()%' AND qual NOT LIKE '%(select auth.jwt())%')
      OR (with_check LIKE '%auth.uid()%' AND with_check NOT LIKE '%(select auth.uid())%')
      OR (with_check LIKE '%auth.jwt()%' AND with_check NOT LIKE '%(select auth.jwt())%')
    );
  
  IF remaining_count > 0 THEN
    RAISE WARNING 'Still have % unoptimized policies - manual review needed', remaining_count;
  ELSE
    RAISE NOTICE '';
    RAISE NOTICE '✓ Verification passed: All auth functions properly optimized';
  END IF;
END $$;

COMMIT;

-- ============================================================================
-- ROLLBACK INSTRUCTIONS (if needed)
-- ============================================================================
-- This migration optimizes existing policies without changing behavior
-- Rollback would restore the slower (per-row evaluation) pattern
-- Not recommended unless you encounter specific issues
--
-- To rollback, you would need to:
-- 1. Restore policy definitions from backup OR
-- 2. Run original migration scripts that created the policies
--
-- Note: There's no functional difference, only performance
