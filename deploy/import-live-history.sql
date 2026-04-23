\set ON_ERROR_STOP on

CREATE EXTENSION IF NOT EXISTS postgres_fdw;

DROP SCHEMA IF EXISTS import_live CASCADE;
CREATE SCHEMA import_live;

DROP SERVER IF EXISTS live_source CASCADE;

SELECT format(
  'CREATE SERVER live_source FOREIGN DATA WRAPPER postgres_fdw OPTIONS (host %L, port %L, dbname %L)',
  :'SRC_HOST',
  :'SRC_PORT',
  :'SRC_DB'
) \gexec

SELECT format(
  'CREATE USER MAPPING FOR CURRENT_USER SERVER live_source OPTIONS (user %L, password %L)',
  :'SRC_USER',
  :'SRC_PASSWORD'
) \gexec

IMPORT FOREIGN SCHEMA public
LIMIT TO (
  app_users,
  extraction_profiles,
  extraction_profile_examples,
  extraction_feedback,
  instruction_policies,
  instruction_policy_events,
  match_history,
  match_candidate_features,
  matching_rule_sets,
  matching_rules,
  matching_rule_audit,
  outbound_order_queue,
  offer_drafts,
  offer_draft_lines,
  matched_offers,
  matched_offer_lines
)
FROM SERVER live_source
INTO import_live;

BEGIN;

TRUNCATE TABLE
  matched_offer_lines,
  matched_offers,
  offer_draft_lines,
  offer_drafts,
  outbound_order_queue,
  matching_rule_audit,
  match_candidate_features,
  matching_rules,
  matching_rule_sets,
  instruction_policy_events,
  instruction_policies,
  extraction_feedback,
  extraction_profile_examples,
  extraction_profiles,
  app_sessions,
  app_users,
  match_history,
  canonical_stock_features,
  stock_features,
  stock_master,
  sync_checkpoint
RESTART IDENTITY CASCADE;

INSERT INTO app_users OVERRIDING SYSTEM VALUE
SELECT * FROM import_live.app_users;

INSERT INTO extraction_profiles OVERRIDING SYSTEM VALUE
SELECT * FROM import_live.extraction_profiles;

INSERT INTO extraction_profile_examples OVERRIDING SYSTEM VALUE
SELECT * FROM import_live.extraction_profile_examples;

INSERT INTO extraction_feedback OVERRIDING SYSTEM VALUE
SELECT * FROM import_live.extraction_feedback;

INSERT INTO instruction_policies OVERRIDING SYSTEM VALUE
SELECT * FROM import_live.instruction_policies;

INSERT INTO instruction_policy_events OVERRIDING SYSTEM VALUE
SELECT * FROM import_live.instruction_policy_events;

INSERT INTO match_history OVERRIDING SYSTEM VALUE
SELECT * FROM import_live.match_history;

INSERT INTO match_candidate_features OVERRIDING SYSTEM VALUE
SELECT * FROM import_live.match_candidate_features;

INSERT INTO matching_rule_sets OVERRIDING SYSTEM VALUE
SELECT * FROM import_live.matching_rule_sets;

INSERT INTO matching_rules OVERRIDING SYSTEM VALUE
SELECT * FROM import_live.matching_rules;

INSERT INTO matching_rule_audit OVERRIDING SYSTEM VALUE
SELECT * FROM import_live.matching_rule_audit;

INSERT INTO outbound_order_queue OVERRIDING SYSTEM VALUE
SELECT * FROM import_live.outbound_order_queue;

INSERT INTO offer_drafts OVERRIDING SYSTEM VALUE
SELECT * FROM import_live.offer_drafts;

INSERT INTO offer_draft_lines OVERRIDING SYSTEM VALUE
SELECT * FROM import_live.offer_draft_lines;

INSERT INTO matched_offers OVERRIDING SYSTEM VALUE
SELECT * FROM import_live.matched_offers;

INSERT INTO matched_offer_lines OVERRIDING SYSTEM VALUE
SELECT * FROM import_live.matched_offer_lines;

COMMIT;

SELECT setval(pg_get_serial_sequence('app_users', 'id'), COALESCE((SELECT MAX(id) FROM app_users), 1), (SELECT COUNT(*) > 0 FROM app_users));
SELECT setval(pg_get_serial_sequence('extraction_profiles', 'id'), COALESCE((SELECT MAX(id) FROM extraction_profiles), 1), (SELECT COUNT(*) > 0 FROM extraction_profiles));
SELECT setval(pg_get_serial_sequence('extraction_profile_examples', 'id'), COALESCE((SELECT MAX(id) FROM extraction_profile_examples), 1), (SELECT COUNT(*) > 0 FROM extraction_profile_examples));
SELECT setval(pg_get_serial_sequence('extraction_feedback', 'id'), COALESCE((SELECT MAX(id) FROM extraction_feedback), 1), (SELECT COUNT(*) > 0 FROM extraction_feedback));
SELECT setval(pg_get_serial_sequence('instruction_policies', 'id'), COALESCE((SELECT MAX(id) FROM instruction_policies), 1), (SELECT COUNT(*) > 0 FROM instruction_policies));
SELECT setval(pg_get_serial_sequence('instruction_policy_events', 'id'), COALESCE((SELECT MAX(id) FROM instruction_policy_events), 1), (SELECT COUNT(*) > 0 FROM instruction_policy_events));
SELECT setval(pg_get_serial_sequence('match_history', 'id'), COALESCE((SELECT MAX(id) FROM match_history), 1), (SELECT COUNT(*) > 0 FROM match_history));
SELECT setval(pg_get_serial_sequence('match_candidate_features', 'id'), COALESCE((SELECT MAX(id) FROM match_candidate_features), 1), (SELECT COUNT(*) > 0 FROM match_candidate_features));
SELECT setval(pg_get_serial_sequence('matching_rule_sets', 'id'), COALESCE((SELECT MAX(id) FROM matching_rule_sets), 1), (SELECT COUNT(*) > 0 FROM matching_rule_sets));
SELECT setval(pg_get_serial_sequence('matching_rules', 'id'), COALESCE((SELECT MAX(id) FROM matching_rules), 1), (SELECT COUNT(*) > 0 FROM matching_rules));
SELECT setval(pg_get_serial_sequence('matching_rule_audit', 'id'), COALESCE((SELECT MAX(id) FROM matching_rule_audit), 1), (SELECT COUNT(*) > 0 FROM matching_rule_audit));
SELECT setval(pg_get_serial_sequence('outbound_order_queue', 'id'), COALESCE((SELECT MAX(id) FROM outbound_order_queue), 1), (SELECT COUNT(*) > 0 FROM outbound_order_queue));
SELECT setval(pg_get_serial_sequence('offer_drafts', 'id'), COALESCE((SELECT MAX(id) FROM offer_drafts), 1), (SELECT COUNT(*) > 0 FROM offer_drafts));
SELECT setval(pg_get_serial_sequence('offer_draft_lines', 'id'), COALESCE((SELECT MAX(id) FROM offer_draft_lines), 1), (SELECT COUNT(*) > 0 FROM offer_draft_lines));
SELECT setval(pg_get_serial_sequence('matched_offers', 'id'), COALESCE((SELECT MAX(id) FROM matched_offers), 1), (SELECT COUNT(*) > 0 FROM matched_offers));
SELECT setval(pg_get_serial_sequence('matched_offer_lines', 'id'), COALESCE((SELECT MAX(id) FROM matched_offer_lines), 1), (SELECT COUNT(*) > 0 FROM matched_offer_lines));

DROP SCHEMA IF EXISTS import_live CASCADE;
DROP SERVER IF EXISTS live_source CASCADE;

