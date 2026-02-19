-- ============================================================
-- Archivision AI - Creative Datasets Table
-- Tracks AI generation data for model improvement
-- ============================================================

CREATE TABLE IF NOT EXISTS public.creative_datasets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  input_image_path TEXT,
  input_scene_analysis JSONB,
  user_command TEXT NOT NULL DEFAULT '',
  detected_intent JSONB,
  output_image_path TEXT,
  prompt_sent TEXT NOT NULL DEFAULT '',
  model_used TEXT NOT NULL DEFAULT 'gemini-3-pro-image-preview',
  user_accepted BOOLEAN DEFAULT true,
  user_regenerated BOOLEAN DEFAULT false,
  page_source TEXT NOT NULL CHECK (page_source IN ('PHOTO', 'PLAN', 'VIDEO')),
  style_tags TEXT[] DEFAULT '{}',
  object_tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.creative_datasets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own creative data" ON public.creative_datasets
  FOR ALL USING (auth.uid() = user_id);

CREATE INDEX idx_creative_datasets_user ON public.creative_datasets(user_id, created_at DESC);
