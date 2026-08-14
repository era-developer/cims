-- Programs become a proper managed entity (not free text): who's handling it,
-- start/expected-end dates, and the institute involved (if any).
ALTER TABLE projects ADD COLUMN handled_by TEXT;
ALTER TABLE projects ADD COLUMN institute_name TEXT;
ALTER TABLE projects ADD COLUMN expected_end_date TEXT;
ALTER TABLE projects ADD COLUMN notes TEXT;

-- Damage events need to record which program the damaged unit belonged to.
ALTER TABLE asset_lifecycle_events ADD COLUMN project_id INTEGER REFERENCES projects(id);
