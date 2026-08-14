-- A short, human-curated code per component type (e.g. "ARDU" for Arduino
-- Uno) used to build a readable asset tag: <CENTER>-<CLASS>-<TAGCODE>-<SEQ>,
-- e.g. JPN-ELEC-ARDU-01. Left NULL, tag generation falls back to the
-- existing <CENTER>-<CLASS>-<SEQ> scheme unchanged -- purely additive.
ALTER TABLE product_catalog ADD COLUMN tag_code TEXT;
