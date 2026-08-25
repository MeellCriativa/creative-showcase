-- =============================================================
-- FIX: All missing columns + background_color + schema reload
-- This is the DEFINITIVE migration that ensures ALL columns
-- used by the frontend exist in the database.
-- Safe to run multiple times (IF NOT EXISTS on everything).
-- =============================================================

-- ── catalogs: all personalization columns ──
ALTER TABLE public.catalogs
  ADD COLUMN IF NOT EXISTS store_font            TEXT    NOT NULL DEFAULT 'moderna',
  ADD COLUMN IF NOT EXISTS logo_size             TEXT    NOT NULL DEFAULT 'medio',
  ADD COLUMN IF NOT EXISTS logo_position         TEXT    NOT NULL DEFAULT 'esquerda',
  ADD COLUMN IF NOT EXISTS cart_style            TEXT    NOT NULL DEFAULT 'carrinho',
  ADD COLUMN IF NOT EXISTS banner_enabled        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS banner_autoplay       BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS banner_interval       INT     NOT NULL DEFAULT 4,
  ADD COLUMN IF NOT EXISTS banner_indicators     BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS whatsapp_button_color TEXT    DEFAULT '#8b5cf6',
  ADD COLUMN IF NOT EXISTS store_description     TEXT,
  ADD COLUMN IF NOT EXISTS instagram_url         TEXT,
  ADD COLUMN IF NOT EXISTS payment_methods       JSONB   DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS owner_photo_url       TEXT,
  ADD COLUMN IF NOT EXISTS owner_name            TEXT,
  ADD COLUMN IF NOT EXISTS owner_bio             TEXT,
  ADD COLUMN IF NOT EXISTS owner_hours           TEXT,
  ADD COLUMN IF NOT EXISTS background_color      TEXT    DEFAULT '#FFFFFF';

-- Fix defaults for existing columns
ALTER TABLE public.catalogs
  ALTER COLUMN primary_color SET DEFAULT '#8b5cf6',
  ALTER COLUMN accent_color  SET DEFAULT '#f3eefc';

-- ── banners: object_position ──
ALTER TABLE public.banners
  ADD COLUMN IF NOT EXISTS object_position TEXT DEFAULT 'center';

-- ── products: price_options ──
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS price_options JSONB DEFAULT '[]'::jsonb;

-- ── Reload PostgREST schema cache ──
NOTIFY pgrst, 'reload schema';
