-- Add price_options to products for multi-price support
-- Each option: { id: string, label: string, price: number }
ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS price_options JSONB NOT NULL DEFAULT '[]'::jsonb;
