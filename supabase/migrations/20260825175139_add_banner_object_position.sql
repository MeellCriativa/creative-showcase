-- Add object_position to banners for image crop control
ALTER TABLE public.banners
  ADD COLUMN IF NOT EXISTS object_position TEXT NOT NULL DEFAULT 'center';
