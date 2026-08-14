-- Optional curated reference video links for a component (e.g. a real
-- "how to use this with Arduino" tutorial), shown on the student-facing
-- component detail page. Stored as a JSON array of {title, url} objects
-- (0-2 entries in practice) -- same JSON-in-TEXT convention already used
-- elsewhere in this schema (e.g. order itemsJson), rather than new tables
-- for what's a small, optional, per-catalog-item extra.
ALTER TABLE product_catalog ADD COLUMN reference_videos TEXT;
