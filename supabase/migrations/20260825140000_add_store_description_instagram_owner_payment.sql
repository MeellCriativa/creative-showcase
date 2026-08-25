-- Add store description, instagram, payment methods, and owner info columns
-- Store description and Instagram (from previous plan)
ALTER TABLE catalogs ADD COLUMN IF NOT EXISTS store_description text;
ALTER TABLE catalogs ADD COLUMN IF NOT EXISTS instagram_url text;

-- Payment methods: array of active method keys (e.g. ["pix","credit_card","debit_card","cash"])
-- NULL or empty = don't show payment section
ALTER TABLE catalogs ADD COLUMN IF NOT EXISTS payment_methods jsonb DEFAULT '[]'::jsonb;

-- Owner / store presentation info
ALTER TABLE catalogs ADD COLUMN IF NOT EXISTS owner_photo_url text;
ALTER TABLE catalogs ADD COLUMN IF NOT EXISTS owner_name text;
ALTER TABLE catalogs ADD COLUMN IF NOT EXISTS owner_bio text;
ALTER TABLE catalogs ADD COLUMN IF NOT EXISTS owner_hours text;
