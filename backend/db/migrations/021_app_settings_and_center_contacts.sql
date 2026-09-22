-- Make org-level settings and per-center contacts editable at runtime.
--
-- Before this migration the order-notification email and the WhatsApp admin
-- number could only be changed by editing backend/.env and restarting the
-- service ({CENTER_ID}_EMAIL / {CENTER_ID}_WHATSAPP_ADMIN_TO). That is fine
-- for a deployment whose centers never change, but a super admin needs to
-- re-point notifications when the responsible admin at a center changes,
-- and to onboard a new center without a code deploy. Both now live in the
-- database; the env vars remain as a fallback so existing deployments keep
-- working untouched.

PRAGMA foreign_keys = ON;

-- ---------- Org-level settings ----------

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by TEXT
);

-- ---------- Per-center contact + provenance ----------
-- Nullable on purpose: NULL means "inherit the org-level default", which is
-- what every center carried over from the pre-migration env-var setup does.

ALTER TABLE centers ADD COLUMN notification_email TEXT;
ALTER TABLE centers ADD COLUMN whatsapp_number TEXT;

-- No datetime('now') default here: SQLite rejects non-constant defaults in
-- ALTER TABLE ADD COLUMN. Rows that predate this migration keep NULL, which
-- reads as "existed before we started tracking".
ALTER TABLE centers ADD COLUMN created_at TEXT;
ALTER TABLE centers ADD COLUMN updated_at TEXT;

CREATE INDEX IF NOT EXISTS idx_centers_active ON centers(active);
