-- Scanned/photographed copies of the original vendor invoice, attached after
-- the fact. Separate from the structured invoice_line_items data -- this is
-- the actual source document, potentially multi-page/PDF, for audit purposes.
CREATE TABLE IF NOT EXISTS invoice_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  storage_path TEXT NOT NULL,
  uploaded_by TEXT,
  uploaded_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_invoice_documents_invoice_id ON invoice_documents(invoice_id);
