-- A center asking the super admin to procure new components it doesn't
-- have (or doesn't have enough of) -- distinct from Transfers, which moves
-- EXISTING stock between centers. Fulfillment (marking Received) is tracking
-- only; the real stock still gets added the normal way, through Invoice Entry.
CREATE TABLE IF NOT EXISTS procurement_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  center_id TEXT NOT NULL REFERENCES centers(id),
  requested_by TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN
    ('Requested', 'Approved', 'Rejected', 'Order Placed', 'In Transit', 'Received')) DEFAULT 'Requested',
  admin_remarks TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  approved_at TEXT,
  order_placed_at TEXT,
  in_transit_at TEXT,
  received_at TEXT
);

CREATE TABLE IF NOT EXISTS procurement_request_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  procurement_request_id INTEGER NOT NULL REFERENCES procurement_requests(id) ON DELETE CASCADE,
  component_name TEXT NOT NULL,
  qty_requested INTEGER NOT NULL,
  reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_procurement_requests_center_id ON procurement_requests(center_id);
