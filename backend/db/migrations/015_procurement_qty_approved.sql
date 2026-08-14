-- Mirrors issue_record_items' qty_requested/qty_approved split: keep the
-- original ask on record even if the super admin adjusts it at approval time.
ALTER TABLE procurement_request_items ADD COLUMN qty_approved INTEGER;
