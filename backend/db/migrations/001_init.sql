-- CIMS v2 schema (Phase 0)
-- Reference: VERSION_2_PLAN.md at the repo root.

PRAGMA foreign_keys = ON;

-- ---------- Master data ----------

CREATE TABLE IF NOT EXISTS centers (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS vendors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  gstin TEXT,
  contact_name TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS business_heads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS classifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT UNIQUE NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  center_id TEXT REFERENCES centers(id),
  business_head_id INTEGER REFERENCES business_heads(id),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'archived')),
  start_date TEXT,
  completion_date TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (center_id, name)
);

-- ---------- Procurement ----------

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  center_id TEXT NOT NULL REFERENCES centers(id),
  invoice_number TEXT NOT NULL,
  invoice_date TEXT,
  vendor_id INTEGER NOT NULL REFERENCES vendors(id),
  project_id INTEGER REFERENCES projects(id),
  business_head_id INTEGER REFERENCES business_heads(id),
  installation_charges REAL NOT NULL DEFAULT 0,
  freight_charges REAL NOT NULL DEFAULT 0,
  taxable_value REAL,
  gst_value REAL,
  total_bill_value REAL,
  is_legacy INTEGER NOT NULL DEFAULT 0,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (center_id, invoice_number)
);

CREATE TABLE IF NOT EXISTS invoice_line_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id),
  classification_id INTEGER NOT NULL REFERENCES classifications(id),
  asset_name TEXT NOT NULL,
  bill_quantity INTEGER NOT NULL,
  unit TEXT NOT NULL DEFAULT 'pcs',
  unit_price REAL,
  taxable_value REAL,
  gst_percent REAL NOT NULL DEFAULT 0,
  gst_value REAL NOT NULL DEFAULT 0,
  total_value REAL,
  purchased_for TEXT
);

CREATE TABLE IF NOT EXISTS product_catalog (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  center_id TEXT NOT NULL REFERENCES centers(id),
  name TEXT NOT NULL,
  classification_id INTEGER REFERENCES classifications(id),
  category TEXT,
  unit TEXT NOT NULL DEFAULT 'pcs',
  reorder_point INTEGER,
  UNIQUE (center_id, name)
);

-- ---------- Assets & lifecycle ----------

CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  asset_tag TEXT UNIQUE NOT NULL,
  center_id TEXT NOT NULL REFERENCES centers(id),
  catalog_id INTEGER REFERENCES product_catalog(id),
  invoice_line_item_id INTEGER REFERENCES invoice_line_items(id),
  classification_id INTEGER NOT NULL REFERENCES classifications(id),
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  unit TEXT NOT NULL DEFAULT 'pcs',
  unit_value REAL,
  serial_number TEXT,
  location TEXT,
  status TEXT NOT NULL DEFAULT 'available' CHECK (status IN
    ('available', 'reserved', 'issued', 'return_requested', 'under_repair', 'damaged', 'disposed')),
  is_consumable INTEGER NOT NULL DEFAULT 0,
  is_legacy INTEGER NOT NULL DEFAULT 0,
  legacy_source_sku_id TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  added_date TEXT NOT NULL,
  image TEXT
);

CREATE TABLE IF NOT EXISTS asset_lifecycle_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  asset_id TEXT NOT NULL REFERENCES assets(id),
  event_type TEXT NOT NULL CHECK (event_type IN
    ('procured', 'reserved', 'issued', 'return_requested', 'returned', 'repair_started',
     'repair_completed', 'damaged', 'disposed', 'transferred_out', 'transferred_in', 'adjusted')),
  from_status TEXT,
  to_status TEXT NOT NULL,
  issue_record_id INTEGER,
  transfer_id INTEGER,
  center_id TEXT NOT NULL,
  notes TEXT,
  performed_by TEXT,
  occurred_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- Students & issue/return ----------

CREATE TABLE IF NOT EXISTS students (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  full_name TEXT NOT NULL,
  student_code TEXT,
  college TEXT,
  degree TEXT,
  department TEXT,
  course_name TEXT,
  graduation_year TEXT,
  mobile TEXT,
  email TEXT,
  center_id TEXT NOT NULL REFERENCES centers(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (center_id, mobile)
);

CREATE TABLE IF NOT EXISTS issue_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT UNIQUE NOT NULL,
  center_id TEXT NOT NULL REFERENCES centers(id),
  student_id INTEGER NOT NULL REFERENCES students(id),
  project_id INTEGER REFERENCES projects(id),
  team_name TEXT,
  faculty_guide TEXT,
  purpose TEXT,
  status TEXT NOT NULL CHECK (status IN
    ('Pending', 'Approved', 'Rejected', 'Return Requested', 'Partially Returned', 'Returned')),
  admin_remarks TEXT,
  expected_return_date TEXT,
  reminder_sent_at TEXT,
  created_at TEXT,
  reserved_at TEXT,
  issued_at TEXT,
  return_requested_at TEXT,
  returned_at TEXT,
  last_return_at TEXT
);

CREATE TABLE IF NOT EXISTS issue_record_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_record_id INTEGER NOT NULL REFERENCES issue_records(id),
  catalog_id INTEGER REFERENCES product_catalog(id),
  name TEXT NOT NULL,
  qty_requested INTEGER NOT NULL,
  qty_approved INTEGER,
  unit TEXT NOT NULL DEFAULT 'pcs'
);

CREATE TABLE IF NOT EXISTS issue_record_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_record_item_id INTEGER NOT NULL REFERENCES issue_record_items(id),
  asset_id TEXT NOT NULL REFERENCES assets(id),
  condition_on_issue TEXT,
  condition_on_return TEXT
);

CREATE TABLE IF NOT EXISTS order_return_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  issue_record_item_id INTEGER NOT NULL REFERENCES issue_record_items(id),
  returned_qty INTEGER NOT NULL DEFAULT 0,
  damaged_qty INTEGER NOT NULL DEFAULT 0,
  consumed_qty INTEGER NOT NULL DEFAULT 0,
  pending_qty INTEGER NOT NULL DEFAULT 0,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- Transfers ----------

CREATE TABLE IF NOT EXISTS transfers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transfer_code TEXT UNIQUE NOT NULL,
  requesting_center_id TEXT NOT NULL REFERENCES centers(id),
  supply_center_id TEXT REFERENCES centers(id),
  requested_by TEXT,
  status TEXT NOT NULL DEFAULT 'Pending',
  program_name TEXT,
  responsible_person TEXT,
  responsible_email TEXT,
  purpose TEXT,
  desired_return_date TEXT,
  notes TEXT,
  supplier_remarks TEXT,
  return_notes TEXT,
  request_date TEXT,
  status_updated_at TEXT,
  approved_at TEXT,
  return_requested_at TEXT,
  returned_at TEXT
);

CREATE TABLE IF NOT EXISTS transfer_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transfer_id INTEGER NOT NULL REFERENCES transfers(id),
  catalog_id INTEGER REFERENCES product_catalog(id),
  name TEXT NOT NULL,
  qty_requested INTEGER NOT NULL,
  unit TEXT NOT NULL DEFAULT 'pcs'
);

CREATE TABLE IF NOT EXISTS transfer_item_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  transfer_item_id INTEGER NOT NULL REFERENCES transfer_items(id),
  asset_id TEXT NOT NULL REFERENCES assets(id)
);

-- ---------- BOM & waste ----------

CREATE TABLE IF NOT EXISTS boms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  project_id INTEGER REFERENCES projects(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bom_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bom_id INTEGER NOT NULL REFERENCES boms(id),
  catalog_id INTEGER REFERENCES product_catalog(id),
  component_name TEXT NOT NULL,
  standard_quantity REAL NOT NULL,
  uom TEXT NOT NULL,
  classification_id INTEGER REFERENCES classifications(id),
  is_consumable INTEGER NOT NULL DEFAULT 0,
  preferred_vendor_id INTEGER REFERENCES vendors(id)
);

CREATE TABLE IF NOT EXISTS waste_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id),
  catalog_id INTEGER REFERENCES product_catalog(id),
  component_name TEXT NOT NULL,
  qty_issued REAL,
  qty_consumed REAL,
  qty_wasted REAL,
  qty_recoverable REAL,
  qty_non_recoverable REAL,
  unit_cost REAL,
  total_waste_value REAL,
  recorded_by TEXT,
  recorded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- Auth ----------

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  center_id TEXT REFERENCES centers(id),
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT,
  mobile TEXT,
  alt_mobile TEXT,
  college TEXT,
  graduation_year TEXT,
  degree TEXT,
  department TEXT,
  role TEXT NOT NULL CHECK (role IN ('student', 'admin', 'super_admin')),
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT,
  source TEXT NOT NULL DEFAULT 'manual'
);

-- ---------- Indexes ----------

CREATE INDEX IF NOT EXISTS idx_assets_center_status ON assets(center_id, status);
CREATE INDEX IF NOT EXISTS idx_assets_catalog ON assets(catalog_id);
CREATE INDEX IF NOT EXISTS idx_assets_classification ON assets(classification_id);
CREATE INDEX IF NOT EXISTS idx_lifecycle_asset_time ON asset_lifecycle_events(asset_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_issue_records_center_status ON issue_records(center_id, status);
CREATE INDEX IF NOT EXISTS idx_issue_records_student ON issue_records(student_id);
CREATE INDEX IF NOT EXISTS idx_invoice_line_items_invoice ON invoice_line_items(invoice_id);
CREATE INDEX IF NOT EXISTS idx_product_catalog_center_name ON product_catalog(center_id, name);
CREATE INDEX IF NOT EXISTS idx_users_center ON users(center_id);
