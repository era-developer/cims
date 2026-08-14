-- Internal component usage: staff pulling stock for a session/project rather
-- than a student checkout. Stock reduces immediately on submission (no
-- Pending/Approved step -- the admin recording it IS the approval), and
-- returns split into good/damaged, same shape as the student return flow.
CREATE TABLE IF NOT EXISTS internal_issues (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  center_id TEXT NOT NULL REFERENCES centers(id),
  issue_code TEXT NOT NULL UNIQUE,
  taken_by TEXT NOT NULL,
  project_id INTEGER REFERENCES projects(id),
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Issued', 'Partially Returned', 'Returned')) DEFAULT 'Issued',
  issued_by TEXT,
  issued_at TEXT NOT NULL DEFAULT (datetime('now')),
  returned_at TEXT
);

CREATE TABLE IF NOT EXISTS internal_issue_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  internal_issue_id INTEGER NOT NULL REFERENCES internal_issues(id) ON DELETE CASCADE,
  catalog_id INTEGER NOT NULL REFERENCES product_catalog(id),
  name TEXT NOT NULL,
  qty INTEGER NOT NULL,
  unit TEXT NOT NULL DEFAULT 'pcs'
);

CREATE TABLE IF NOT EXISTS internal_issue_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  internal_issue_item_id INTEGER NOT NULL REFERENCES internal_issue_items(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL REFERENCES assets(id),
  condition_on_return TEXT
);

CREATE TABLE IF NOT EXISTS internal_issue_return_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  internal_issue_item_id INTEGER NOT NULL REFERENCES internal_issue_items(id) ON DELETE CASCADE,
  returned_good_qty INTEGER NOT NULL DEFAULT 0,
  returned_damaged_qty INTEGER NOT NULL DEFAULT 0,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_internal_issues_center_id ON internal_issues(center_id);
CREATE INDEX IF NOT EXISTS idx_internal_issues_project_id ON internal_issues(project_id);
CREATE INDEX IF NOT EXISTS idx_internal_issue_items_internal_issue_id ON internal_issue_items(internal_issue_id);
CREATE INDEX IF NOT EXISTS idx_internal_issue_assets_item_id ON internal_issue_assets(internal_issue_item_id);
