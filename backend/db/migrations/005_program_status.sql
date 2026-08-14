-- Program status becomes a manual field set by mentors/admins (planning,
-- ongoing, completed) instead of the old free-form active/completed/archived
-- set. SQLite can't alter a CHECK constraint in place, so the table is
-- rebuilt; ids are preserved so every existing FK (invoices.project_id,
-- asset_lifecycle_events.project_id, etc.) keeps pointing at the same rows.
PRAGMA foreign_keys = OFF;

CREATE TABLE projects_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  center_id TEXT REFERENCES centers(id),
  business_head_id INTEGER REFERENCES business_heads(id),
  status TEXT NOT NULL DEFAULT 'planning' CHECK (status IN ('planning', 'ongoing', 'completed')),
  start_date TEXT,
  completion_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  handled_by TEXT,
  institute_name TEXT,
  expected_end_date TEXT,
  notes TEXT,
  UNIQUE (center_id, name)
);

INSERT INTO projects_new (id, name, center_id, business_head_id, status, start_date, completion_date,
                           created_at, handled_by, institute_name, expected_end_date, notes)
SELECT id, name, center_id, business_head_id,
  CASE status WHEN 'completed' THEN 'completed' WHEN 'archived' THEN 'completed' ELSE 'ongoing' END,
  start_date, completion_date, created_at, handled_by, institute_name, expected_end_date, notes
FROM projects;

DROP TABLE projects;
ALTER TABLE projects_new RENAME TO projects;

PRAGMA foreign_keys = ON;
