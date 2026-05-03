-- Migration 018: locked kural desteği + erp_cap global hard rule
-- locked = true olan kural setleri chat prompt tarafından override edilemez.

ALTER TABLE matching_rule_sets
  ADD COLUMN IF NOT EXISTS locked BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN matching_rule_sets.locked IS
  'true ise bu kural seti chat oturumu tarafından devre dışı bırakılamaz (hard constraint).';

-- erp_cap global hard rule:
-- Input'ta kalınlık/boyut verilmişse (dim1 exists),
-- adayın erp_cap alanı boş olamaz.
-- Bu kural, scoring'deki -140/-22 cezalarının yerini alır.

INSERT INTO matching_rule_sets (name, scope_type, scope_value, priority, active, locked, created_by)
VALUES (
  'erp_cap_zorunlu_global',
  'global',
  NULL,
  10,
  TRUE,
  TRUE,
  'system'
)
ON CONFLICT DO NOTHING;

-- Yukarıdaki set'in id'sini alıp rule'u ekle
DO $$
DECLARE
  v_set_id BIGINT;
BEGIN
  SELECT id INTO v_set_id
  FROM matching_rule_sets
  WHERE name = 'erp_cap_zorunlu_global'
  LIMIT 1;

  IF v_set_id IS NOT NULL THEN
    INSERT INTO matching_rules (
      rule_set_id, rule_type, target_level,
      condition_json, effect_json,
      stop_on_match, active, description
    )
    SELECT
      v_set_id,
      'hard_filter',
      'pair',
      '{"field": "input.dim1", "op": "exists"}'::jsonb,
      '{"type": "reject_if_missing_dimension", "dimension": "thickness"}'::jsonb,
      FALSE,
      TRUE,
      'Giriş metninde kalınlık/boyut varsa erp_cap boş olan adaylar elenir.'
    WHERE NOT EXISTS (
      SELECT 1 FROM matching_rules
      WHERE rule_set_id = v_set_id
        AND effect_json->>'type' = 'reject_if_missing_dimension'
        AND effect_json->>'dimension' = 'thickness'
    );
  END IF;
END $$;

-- ALV ince stok kuralını da locked olarak işaretle
-- (coding'den kaldırıldı, artık sadece DB kuralı)
UPDATE matching_rule_sets
SET locked = FALSE
WHERE name NOT IN ('erp_cap_zorunlu_global');
