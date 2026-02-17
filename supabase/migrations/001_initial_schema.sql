-- ============================================================
-- Archivision AI - Full Database Schema
-- Run this in Supabase SQL Editor (Dashboard > SQL Editor > New Query)
-- ============================================================

-- 1. User Profiles (extends auth.users)
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own profile" ON public.user_profiles
  FOR ALL USING (auth.uid() = id);

-- 2. User Preferences & AI Memory
CREATE TABLE IF NOT EXISTS public.user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID UNIQUE NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  preferred_styles TEXT[] DEFAULT '{}',
  default_initials TEXT DEFAULT '',
  ai_memory_summary TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own preferences" ON public.user_preferences
  FOR ALL USING (auth.uid() = user_id);

-- 3. Conversations (projects/sessions)
CREATE TABLE IF NOT EXISTS public.conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title TEXT DEFAULT 'Untitled Project',
  tab_source TEXT NOT NULL CHECK (tab_source IN ('PHOTO', 'PLAN', 'VIDEO')),
  summary TEXT DEFAULT '',
  message_count INTEGER DEFAULT 0,
  thumbnail_path TEXT,
  is_archived BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own conversations" ON public.conversations
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX idx_conversations_user ON public.conversations(user_id, updated_at DESC);

-- 4. Messages (individual DesignSteps within a conversation)
CREATE TABLE IF NOT EXISTS public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'model')),
  text TEXT,
  image_paths TEXT[] DEFAULT '{}',
  selected_image_index INTEGER DEFAULT 0,
  is_mask_edit BOOLEAN DEFAULT false,
  floor_plan_data JSONB,
  metadata JSONB DEFAULT '{}',
  sequence_order INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own messages" ON public.messages
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX idx_messages_conversation ON public.messages(conversation_id, sequence_order);

-- 5. Assets (persisted gallery)
CREATE TABLE IF NOT EXISTS public.assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  conversation_id UUID REFERENCES public.conversations(id) ON DELETE SET NULL,
  message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  storage_path TEXT NOT NULL,
  public_url TEXT,
  type TEXT NOT NULL CHECK (type IN ('IMAGE', 'VIDEO')),
  source TEXT NOT NULL CHECK (source IN ('PHOTO', 'PLAN', 'VIDEO')),
  prompt TEXT DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own assets" ON public.assets
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX idx_assets_user ON public.assets(user_id, created_at DESC);

-- 6. Context Snapshots (periodic AI-generated conversation summaries)
CREATE TABLE IF NOT EXISTS public.context_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  summary TEXT NOT NULL,
  key_preferences JSONB DEFAULT '{}',
  covers_through_sequence INTEGER NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.context_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own snapshots" ON public.context_snapshots
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX idx_context_snapshots_conv ON public.context_snapshots(conversation_id, covers_through_sequence DESC);

-- 7. Auto-create profile & preferences on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  INSERT INTO public.user_preferences (user_id)
  VALUES (NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop trigger if exists to avoid errors on re-run
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 8. Storage bucket for user images
-- NOTE: Run this separately in the Supabase Dashboard > Storage > Create bucket
-- Bucket name: user-images
-- Public: false
-- Allowed MIME types: image/png, image/jpeg, image/webp, video/mp4
--
-- Then add this storage policy via SQL:
-- CREATE POLICY "Users manage own images" ON storage.objects
--   FOR ALL USING (bucket_id = 'user-images' AND auth.uid()::text = (storage.foldername(name))[1]);
