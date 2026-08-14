-- Component description shown to students browsing the catalog. Lives on
-- the catalog row (one per component type), same reasoning as image.
ALTER TABLE product_catalog ADD COLUMN description TEXT;
