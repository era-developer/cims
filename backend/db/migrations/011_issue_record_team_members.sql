-- Structured team member list for a student order, separate from the
-- existing free-text team_name field on issue_records.
CREATE TABLE IF NOT EXISTS issue_record_team_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_record_id INTEGER NOT NULL REFERENCES issue_records(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  mobile TEXT
);

CREATE INDEX IF NOT EXISTS idx_issue_record_team_members_issue_record_id ON issue_record_team_members(issue_record_id);
