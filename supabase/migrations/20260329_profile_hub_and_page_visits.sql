-- =============================================================================
-- PRD-EPIC-PROFILE-HUB-001
-- User Profile Hub foundations:
-- 1) profiles.avatar_url
-- 2) user_page_visits table + RLS
-- 3) user-avatars storage bucket + RLS policies
-- =============================================================================

BEGIN;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS avatar_url TEXT;

CREATE TABLE IF NOT EXISTS user_page_visits (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  path TEXT NOT NULL,
  visited_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_page_visits_user_visited_at
  ON user_page_visits(user_id, visited_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_page_visits_user_path
  ON user_page_visits(user_id, path);

ALTER TABLE user_page_visits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own page visits" ON user_page_visits;
CREATE POLICY "Users can view own page visits"
  ON user_page_visits
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can insert own page visits" ON user_page_visits;
CREATE POLICY "Users can insert own page visits"
  ON user_page_visits
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Users can delete own page visits" ON user_page_visits;
CREATE POLICY "Users can delete own page visits"
  ON user_page_visits
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

INSERT INTO storage.buckets (id, name, public)
VALUES ('user-avatars', 'user-avatars', true)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

DROP POLICY IF EXISTS "Users can upload own avatar" ON storage.objects;
CREATE POLICY "Users can upload own avatar"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'user-avatars'
    AND split_part(name, '/', 1) = auth.uid()::text
  );

DROP POLICY IF EXISTS "Public can view user avatars" ON storage.objects;
CREATE POLICY "Public can view user avatars"
  ON storage.objects
  FOR SELECT
  TO public
  USING (
    bucket_id = 'user-avatars'
  );

DROP POLICY IF EXISTS "Users can update own avatar" ON storage.objects;
CREATE POLICY "Users can update own avatar"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'user-avatars'
    AND split_part(name, '/', 1) = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'user-avatars'
    AND split_part(name, '/', 1) = auth.uid()::text
  );

DROP POLICY IF EXISTS "Users can delete own avatar" ON storage.objects;
CREATE POLICY "Users can delete own avatar"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'user-avatars'
    AND split_part(name, '/', 1) = auth.uid()::text
  );

COMMIT;

