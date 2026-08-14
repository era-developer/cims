-- Students must explicitly agree to the component-lending Terms & Conditions
-- before an order can be placed (enforced server-side, not just a disabled
-- button on the frontend -- a bare client-side checkbox can be bypassed by
-- calling the API directly). NULL means never accepted; a real order will
-- always have a timestamp here once this migration is live.
ALTER TABLE issue_records ADD COLUMN terms_accepted_at TEXT;
