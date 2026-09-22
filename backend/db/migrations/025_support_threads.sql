-- In-portal help: a student (or admin) asks a quick question from the Help
-- bubble; the center's admins answer from Admin -> Support. Modelled as a
-- thread with messages from the start so a later live-chat mode only adds
-- delivery, not a new data model.
--
-- status: open      -- waiting for an admin (new question, or the asker wrote again)
--         answered  -- an admin replied; waiting on the asker
--         closed    -- resolved by either side (a new message reopens it)

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS support_threads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  center_id TEXT REFERENCES centers(id),
  user_id TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  last_message_at TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at TEXT,
  closed_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_support_threads_user ON support_threads(user_id, last_message_at);
CREATE INDEX IF NOT EXISTS idx_support_threads_center ON support_threads(center_id, status, last_message_at);

CREATE TABLE IF NOT EXISTS support_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  thread_id INTEGER NOT NULL REFERENCES support_threads(id) ON DELETE CASCADE,
  sender_user_id TEXT NOT NULL,
  sender_role TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_support_messages_thread ON support_messages(thread_id, id);
