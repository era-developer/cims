-- One-time passcodes for two self-service flows: forgot-password
-- (routes/auth.js) and student order confirmation (routes/orders.js). A
-- single shared table keyed by (user_id, purpose) rather than two separate
-- ones, since both need the exact same lifecycle: generate, email, verify
-- with an attempt limit, expire, single-use.
CREATE TABLE IF NOT EXISTS otp_codes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  purpose TEXT NOT NULL CHECK (purpose IN ('password_reset', 'order_confirmation')),
  code_hash TEXT NOT NULL,
  target_email TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  consumed_at TEXT,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_otp_codes_user_purpose ON otp_codes(user_id, purpose);
