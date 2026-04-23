DELETE FROM app_sessions
WHERE user_id IN (
  SELECT id
  FROM app_users
  WHERE username <> 'admin'
);

DELETE FROM app_users
WHERE username <> 'admin';

UPDATE app_users
SET role = 'admin',
    is_active = TRUE,
    full_name = 'Sistem Yonetici',
    updated_at = NOW()
WHERE username = 'admin';
