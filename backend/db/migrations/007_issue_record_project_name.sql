-- Students can optionally name their own specific project/assignment,
-- separate from the admin-managed Program (projects.name, linked via
-- project_id). Program is the traceable/reportable category; this is just
-- free-text context for the admin reviewing the request.
ALTER TABLE issue_records ADD COLUMN student_project_name TEXT;
