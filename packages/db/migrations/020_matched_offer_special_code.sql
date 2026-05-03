ALTER TABLE matched_offers
  ADD COLUMN IF NOT EXISTS special_code TEXT NULL;
