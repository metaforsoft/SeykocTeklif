INSERT INTO matching_rule_sets(name, scope_type, scope_value, priority, active, version, created_by)
SELECT 'Default Hard Rules', 'global', NULL, 10, TRUE, 1, 'migration'
WHERE NOT EXISTS (
  SELECT 1
  FROM matching_rule_sets
  WHERE name = 'Default Hard Rules'
);

INSERT INTO matching_rules(rule_set_id, rule_type, target_level, condition_json, effect_json, stop_on_match, active, description)
SELECT
  mrs.id,
  'hard_filter',
  'pair',
  '{
    "all": [
      { "field": "input.dim1", "op": ">=", "value": 0 },
      { "field": "input.dim1", "op": "<=", "value": 8 }
    ]
  }'::jsonb,
  '{
    "type": "require_prefix",
    "value": "ALV"
  }'::jsonb,
  TRUE,
  TRUE,
  '0-8 kalinlik araliginda ALV prefix zorunlu'
FROM matching_rule_sets mrs
WHERE mrs.name = 'Default Hard Rules'
  AND NOT EXISTS (
    SELECT 1
    FROM matching_rules mr
    WHERE mr.rule_set_id = mrs.id
      AND mr.description = '0-8 kalinlik araliginda ALV prefix zorunlu'
  );
