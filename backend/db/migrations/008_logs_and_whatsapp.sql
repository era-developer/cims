CREATE TABLE IF NOT EXISTS activity_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  center_id TEXT,
  center_name TEXT,
  username TEXT,
  role TEXT,
  action TEXT NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_activity_logs_center_time ON activity_logs(center_id, created_at);

CREATE TABLE IF NOT EXISTS whatsapp_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT,
  center_id TEXT,
  center_name TEXT,
  ts TEXT,
  direction TEXT,
  from_number TEXT,
  to_number TEXT,
  profile_name TEXT,
  body TEXT,
  channel TEXT,
  order_id TEXT,
  status TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_center_time ON whatsapp_messages(center_id, ts);
