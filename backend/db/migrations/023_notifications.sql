-- In-portal notification centre: one row per recipient per event, the same
-- events that go out by e-mail / push, so anyone can look back at every
-- communication and see what they have and have not read.
CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,            -- order_approved, order_rejected, return_requested, ...
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  url TEXT,                      -- in-app path opened on tap
  ref TEXT,                      -- order id / username the event is about
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  read_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread ON notifications(user_id) WHERE read_at IS NULL;
