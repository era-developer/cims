-- A component request is fundamentally "for a prototype or program" (per
-- the UI copy), so it needs the same Program link every other financial/
-- operational flow already has (Invoices, Internal Issues, damage events).
ALTER TABLE procurement_requests ADD COLUMN project_id INTEGER REFERENCES projects(id);
