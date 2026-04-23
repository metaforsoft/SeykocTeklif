ALTER TABLE matched_offer_lines
  ADD COLUMN IF NOT EXISTS birim_fiyat NUMERIC NULL;
