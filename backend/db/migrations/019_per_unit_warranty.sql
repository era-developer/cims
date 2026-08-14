-- Supersedes 010_catalog_warranty.sql's "one shared date per component
-- type" design -- in practice different purchase batches of the same
-- component (e.g. 10 Raspberry Pi bought on different invoices) have
-- different warranty end dates, and product_catalog.has_warranty/
-- warranty_until was also being propagated across every center sharing
-- that component name, which is simply wrong (each center's own units
-- have their own purchase date and warranty). Warranty now lives on the
-- invoice line item (what the admin enters at purchase time) and is
-- stamped onto each asset created from it (what gets displayed/edited per
-- physical unit). product_catalog.has_warranty/warranty_until are left in
-- place but no longer read or written by the app.
ALTER TABLE invoice_line_items ADD COLUMN has_warranty INTEGER NOT NULL DEFAULT 0;
ALTER TABLE invoice_line_items ADD COLUMN warranty_until TEXT;
ALTER TABLE assets ADD COLUMN has_warranty INTEGER NOT NULL DEFAULT 0;
ALTER TABLE assets ADD COLUMN warranty_until TEXT;
