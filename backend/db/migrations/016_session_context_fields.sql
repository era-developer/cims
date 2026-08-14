-- Optional context for a session/workshop-driven internal use or procurement
-- request (e.g. staff running a workshop for a visiting institute) -- not
-- every record involves external students, so all three stay nullable.
ALTER TABLE internal_issues ADD COLUMN student_count INTEGER;
ALTER TABLE internal_issues ADD COLUMN team_count INTEGER;
ALTER TABLE internal_issues ADD COLUMN institute_name TEXT;

ALTER TABLE procurement_requests ADD COLUMN student_count INTEGER;
ALTER TABLE procurement_requests ADD COLUMN team_count INTEGER;
ALTER TABLE procurement_requests ADD COLUMN institute_name TEXT;
