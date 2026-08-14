-- Photos belong to the component type, not each physical unit -- avoids
-- duplicating a (potentially large, camera-captured) image across every
-- individual asset row of the same catalog item.
ALTER TABLE product_catalog ADD COLUMN image TEXT;
