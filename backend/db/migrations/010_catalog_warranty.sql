-- Warranty tracking is per component TYPE (one shared date, set from Edit
-- Component), not per purchase batch -- simple by design for V2.1.
ALTER TABLE product_catalog ADD COLUMN has_warranty INTEGER NOT NULL DEFAULT 0;
ALTER TABLE product_catalog ADD COLUMN warranty_until TEXT;
