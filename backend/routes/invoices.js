const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const PDFDocument = require('pdfkit');
const { getDb } = require('../utils/db');
const { authMiddleware, adminOnly, superAdminOnly } = require('../middleware/auth');
const { requireCenter, listCenters, getCenterById } = require('../utils/centers');
const { listBusinessHeads } = require('../utils/businessHeads');
const { getOrgName, getOrgShortName } = require('../utils/settings');
const { createAssetTagGenerator } = require('../utils/assetTag');

const router = express.Router();

// Falls back to a text header in the PDF if the logo file isn't present --
// see backend/assets/logo.png.
const LOGO_FILE_PATH = path.join(__dirname, '..', 'assets', 'logo.png');
const LOGO_PATH = fs.existsSync(LOGO_FILE_PATH) ? LOGO_FILE_PATH : null;

// Scanned/photographed copies of the original vendor invoice -- stored on
// disk (not in the DB) since these can be real multi-page PDFs. Filed as
// data/invoices/<CENTER CODE>/<year>/<invoice number>/<original filename>,
// so the folder can be browsed without the portal. See utils/storage.js.
const { invoiceDocumentDir, safeFilename, uniquePath, toRelative, resolveStored } = require('../utils/storage');
const ALLOWED_DOC_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf']);

function invoiceFolderFor(db, invoiceId) {
  const row = db.prepare(`
    SELECT i.invoice_number, i.invoice_date, c.code AS center_code
    FROM invoices i JOIN centers c ON c.id = i.center_id WHERE i.id = ?
  `).get(invoiceId);
  if (!row) throw new Error('Invoice not found');
  return invoiceDocumentDir({ centerCode: row.center_code, invoiceDate: row.invoice_date, invoiceNumber: row.invoice_number });
}

const documentUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => {
      try {
        cb(null, invoiceFolderFor(getDb(), req.params.id));
      } catch (err) {
        cb(err);
      }
    },
    filename: (req, file, cb) => {
      const dir = invoiceFolderFor(getDb(), req.params.id);
      cb(null, path.basename(uniquePath(dir, safeFilename(file.originalname, 'document'))));
    },
  }),
  limits: { fileSize: 15 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => {
    if (!ALLOWED_DOC_TYPES.has(file.mimetype)) {
      return cb(new Error('Only image (JPEG/PNG/WEBP/HEIC) or PDF files are allowed'));
    }
    cb(null, true);
  },
});

function getRequestedCenterId(req) {
  if (req.user.role === 'super_admin') {
    return String(req.query.centerId || req.body.centerId || '').trim();
  }
  return req.user.centerId;
}

function getOrCreateByName(db, table, name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return null;
  const existing = db.prepare(`SELECT id FROM ${table} WHERE name = ?`).get(trimmed);
  if (existing) return existing.id;
  return db.prepare(`INSERT INTO ${table} (name) VALUES (?)`).run(trimmed).lastInsertRowid;
}

function getOrCreateProject(db, centerId, name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return null;
  const existing = db.prepare('SELECT id FROM projects WHERE center_id = ? AND name = ?').get(centerId, trimmed);
  if (existing) return existing.id;
  return db.prepare('INSERT INTO projects (name, center_id) VALUES (?, ?)').run(trimmed, centerId).lastInsertRowid;
}

// Image and description live on the catalog row (one per component type),
// not per physical unit -- avoids duplicating them across every asset, and
// this is what the student-facing catalog will read from once it's wired
// to the new system.
function getOrCreateCatalog(db, centerId, name, classificationId, unit, image, description) {
  const trimmed = String(name || '').trim();
  const existing = db.prepare('SELECT id, image, description FROM product_catalog WHERE center_id = ? AND name = ?').get(centerId, trimmed);
  if (existing) {
    const nextImage = image && image !== existing.image ? image : null;
    const nextDescription = description && description !== existing.description ? description : null;
    if (nextImage) db.prepare('UPDATE product_catalog SET image = ? WHERE id = ?').run(nextImage, existing.id);
    if (nextDescription) db.prepare('UPDATE product_catalog SET description = ? WHERE id = ?').run(nextDescription, existing.id);
    // Same mirrored-catalog rule as a brand new item: a photo/description
    // added here describes the component itself, not just this center's
    // copy of it, so keep every other center's matching row in sync too.
    if (nextImage || nextDescription) {
      const siblings = db.prepare('SELECT id, image, description FROM product_catalog WHERE name = ? AND center_id != ?').all(trimmed, centerId);
      for (const sibling of siblings) {
        if (nextImage && nextImage !== sibling.image) db.prepare('UPDATE product_catalog SET image = ? WHERE id = ?').run(nextImage, sibling.id);
        if (nextDescription && nextDescription !== sibling.description) db.prepare('UPDATE product_catalog SET description = ? WHERE id = ?').run(nextDescription, sibling.id);
      }
    }
    return existing.id;
  }
  const newId = db.prepare(`
    INSERT INTO product_catalog (center_id, name, classification_id, unit, image, description) VALUES (?, ?, ?, ?, ?, ?)
  `).run(centerId, trimmed, classificationId, unit || 'pcs', image || null, description || null).lastInsertRowid;

  // A genuinely new component type gets mirrored into every other center's
  // catalog at 0 stock, so the component list stays consistent org-wide --
  // other centers just see it exists and can top it up locally via their
  // own invoices later. Not exploded into physical units they don't have.
  for (const center of listCenters()) {
    if (center.id === centerId) continue;
    const alreadyThere = db.prepare('SELECT id FROM product_catalog WHERE center_id = ? AND name = ?').get(center.id, trimmed);
    if (alreadyThere) continue;
    db.prepare(`
      INSERT INTO product_catalog (center_id, name, classification_id, unit, image, description) VALUES (?, ?, ?, ?, ?, ?)
    `).run(center.id, trimmed, classificationId, unit || 'pcs', image || null, description || null);
  }

  return newId;
}

// Dropdown data for the invoice entry form.
router.get('/lookups', authMiddleware, adminOnly, (req, res) => {
  const db = getDb();
  const centerId = getRequestedCenterId(req);
  res.json({
    classifications: db.prepare('SELECT id, name FROM classifications WHERE name != ? ORDER BY sort_order').all('Unclassified (Legacy)'),
    vendors: db.prepare('SELECT id, name FROM vendors ORDER BY name').all(),
    // Active only: a deactivated head stays on its historical invoices but
    // must not be offered for new ones. Managed in Admin -> Settings.
    businessHeads: listBusinessHeads().map(head => ({ id: head.id, name: head.name })),
    projects: centerId
      ? db.prepare('SELECT id, name, status FROM projects WHERE center_id = ? ORDER BY name').all(centerId)
      : [],
  });
});

router.get('/', authMiddleware, adminOnly, (req, res) => {
  const db = getDb();
  const centerId = getRequestedCenterId(req);
  if (!centerId) return res.json([]);
  const invoices = db.prepare(`
    SELECT i.*, v.name AS vendor_name, p.name AS project_name, b.name AS business_head_name,
           (SELECT COUNT(*) FROM invoice_line_items li WHERE li.invoice_id = i.id) AS line_item_count,
           (SELECT GROUP_CONCAT(DISTINCT c.name) FROM invoice_line_items li
              JOIN classifications c ON c.id = li.classification_id WHERE li.invoice_id = i.id) AS classifications
    FROM invoices i
    LEFT JOIN vendors v ON v.id = i.vendor_id
    LEFT JOIN projects p ON p.id = i.project_id
    LEFT JOIN business_heads b ON b.id = i.business_head_id
    WHERE i.center_id = ?
    ORDER BY i.created_at DESC
  `).all(centerId);
  res.json(invoices);
});

function loadInvoiceDetail(db, id) {
  const invoice = db.prepare(`
    SELECT i.*, v.name AS vendor_name, p.name AS project_name, b.name AS business_head_name
    FROM invoices i
    LEFT JOIN vendors v ON v.id = i.vendor_id
    LEFT JOIN projects p ON p.id = i.project_id
    LEFT JOIN business_heads b ON b.id = i.business_head_id
    WHERE i.id = ?
  `).get(id);
  if (!invoice) return null;

  const lineItems = db.prepare(`
    SELECT li.*, c.name AS classification_name
    FROM invoice_line_items li
    JOIN classifications c ON c.id = li.classification_id
    WHERE li.invoice_id = ?
  `).all(invoice.id);

  // description/image live on product_catalog (one per component type), not
  // per line item. Resolve via an existing unit's own catalog_id first
  // (authoritative regardless of any name drift after a rename/merge);
  // fall back to a name lookup only if this line item has no units yet.
  const lineItemsWithAssets = lineItems.map(li => {
    const assets = db.prepare('SELECT id, asset_tag, serial_number, status, catalog_id FROM assets WHERE invoice_line_item_id = ?').all(li.id);
    const linkedCatalogId = assets.find(a => a.catalog_id)?.catalog_id;
    const catalog = linkedCatalogId
      ? db.prepare('SELECT description, image FROM product_catalog WHERE id = ?').get(linkedCatalogId)
      : db.prepare('SELECT description, image FROM product_catalog WHERE center_id = ? AND name = ?').get(invoice.center_id, li.asset_name);
    return {
      ...li,
      description: catalog?.description || '',
      image: catalog?.image || '',
      assets,
    };
  });

  return { ...invoice, lineItems: lineItemsWithAssets };
}

router.get('/:id', authMiddleware, adminOnly, (req, res) => {
  const invoice = loadInvoiceDetail(getDb(), req.params.id);
  if (!invoice) return res.status(404).json({ message: 'Invoice not found' });
  res.json(invoice);
});

// Attaches scanned copies of the original vendor invoice. Restricted the
// same as invoice creation -- this is enriching the same financial record.
router.post('/:id/documents', authMiddleware, superAdminOnly, (req, res) => {
  const db = getDb();
  const invoice = db.prepare('SELECT id FROM invoices WHERE id = ?').get(req.params.id);
  if (!invoice) return res.status(404).json({ message: 'Invoice not found' });

  documentUpload.array('files', 10)(req, res, (err) => {
    if (err) return res.status(400).json({ message: err.message });
    if (!req.files?.length) return res.status(400).json({ message: 'No files uploaded' });

    const insert = db.prepare(`
      INSERT INTO invoice_documents (invoice_id, file_name, mime_type, file_size, storage_path, uploaded_by)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const created = req.files.map(file => {
      const id = insert.run(invoice.id, file.originalname, file.mimetype, file.size, toRelative(file.path), req.user.username).lastInsertRowid;
      return { id, fileName: file.originalname, mimeType: file.mimetype, fileSize: file.size };
    });
    res.status(201).json({ documents: created });
  });
});

router.get('/:id/documents', authMiddleware, adminOnly, (req, res) => {
  const db = getDb();
  const docs = db.prepare(`
    SELECT id, file_name, mime_type, file_size, uploaded_by, uploaded_at
    FROM invoice_documents WHERE invoice_id = ? ORDER BY uploaded_at DESC
  `).all(req.params.id);
  res.json(docs);
});

router.get('/:id/documents/:docId', authMiddleware, adminOnly, (req, res) => {
  const db = getDb();
  const doc = db.prepare('SELECT * FROM invoice_documents WHERE id = ? AND invoice_id = ?').get(req.params.docId, req.params.id);
  const filePath = doc ? resolveStored(doc.storage_path) : '';
  if (!doc || !fs.existsSync(filePath)) return res.status(404).json({ message: 'Document not found' });
  res.setHeader('Content-Type', doc.mime_type);
  res.setHeader('Content-Disposition', `inline; filename="${doc.file_name.replace(/"/g, '')}"`);
  fs.createReadStream(filePath).pipe(res);
});

router.delete('/:id/documents/:docId', authMiddleware, superAdminOnly, (req, res) => {
  const db = getDb();
  const doc = db.prepare('SELECT * FROM invoice_documents WHERE id = ? AND invoice_id = ?').get(req.params.docId, req.params.id);
  if (!doc) return res.status(404).json({ message: 'Document not found' });
  db.prepare('DELETE FROM invoice_documents WHERE id = ?').run(doc.id);
  fs.unlink(resolveStored(doc.storage_path), () => {}); // best-effort; DB record is the source of truth either way
  res.json({ message: 'Document deleted' });
});

function pdfMoney(value) {
  return `Rs ${Number(value || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pdfDate(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function pdfDateTime(value) {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function pdfSectionTitle(doc, title) {
  doc.moveDown(0.7);
  const y = doc.y;
  doc.rect(50, y + 1, 3, 11).fill('#2d2a6e');
  doc.fillColor('#2d2a6e').font('Helvetica-Bold').fontSize(11).text(title, 60, y);
  doc.fillColor('#000');
  doc.moveDown(0.5);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#e2e8f0').stroke();
  doc.moveDown(0.5);
}

// Two fields per row, label above value. Row height is measured from the
// actual value text (long vendor/project names wrap to 2+ lines) -- a fixed
// row height here would let a wrapped value overlap the row below it.
function pdfFieldGrid(doc, fields) {
  const col1X = 50, col1W = 220, col2X = 300, col2W = 245;
  for (let i = 0; i < fields.length; i += 2) {
    const rowY = doc.y;
    const [label1, value1] = fields[i];
    const val1Text = String(value1 || '-');
    doc.font('Helvetica').fontSize(8).fillColor('#6b7280').text(label1.toUpperCase(), col1X, rowY, { width: col1W, characterSpacing: 0.3 });
    doc.font('Helvetica-Bold').fontSize(10);
    const height1 = doc.heightOfString(val1Text, { width: col1W });
    doc.fillColor('#1a1a2e').text(val1Text, col1X, rowY + 12, { width: col1W });

    let height2 = 0;
    if (fields[i + 1]) {
      const [label2, value2] = fields[i + 1];
      const val2Text = String(value2 || '-');
      doc.font('Helvetica').fontSize(8).fillColor('#6b7280').text(label2.toUpperCase(), col2X, rowY, { width: col2W, characterSpacing: 0.3 });
      doc.font('Helvetica-Bold').fontSize(10);
      height2 = doc.heightOfString(val2Text, { width: col2W });
      doc.fillColor('#1a1a2e').text(val2Text, col2X, rowY + 12, { width: col2W });
    }
    doc.y = rowY + 12 + Math.max(height1, height2) + 10;
  }
  doc.fillColor('#000');
}

router.get('/:id/pdf', authMiddleware, adminOnly, (req, res) => {
  const invoice = loadInvoiceDetail(getDb(), req.params.id);
  if (!invoice) return res.status(404).json({ message: 'Invoice not found' });
  // getCenterById, not listCenters(): an invoice from a since-deactivated
  // center must still render its center name on the PDF.
  const center = getCenterById(invoice.center_id);

  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoice.invoice_number}.pdf"`);
  doc.pipe(res);

  const pageWidth = doc.page.width;
  const contentRight = pageWidth - 50;

  // White letterhead -- the logo is dark navy/orange on a transparent
  // background, so it needs white behind it, not a filled color band.
  if (LOGO_PATH) {
    doc.image(LOGO_PATH, 50, 30, { width: 170 });
  } else {
    doc.font('Helvetica-Bold').fontSize(18).fillColor('#2d2a6e').text(getOrgName(), 50, 34);
  }
  doc.font('Helvetica-Bold').fontSize(13).fillColor('#2d2a6e').text(invoice.invoice_number, 0, 30, { align: 'right', width: contentRight });
  doc.font('Helvetica-Bold').fontSize(9).fillColor('#c2410c').text('PURCHASE INVOICE RECORD', 0, 50, { align: 'right', width: contentRight });
  doc.font('Helvetica').fontSize(7.5).fillColor('#9ca3af').text(`Generated ${pdfDateTime(new Date().toISOString())}`, 0, 66, { align: 'right', width: contentRight });
  doc.fillColor('#000');

  doc.rect(0, 92, pageWidth, 3).fill('#2d2a6e');
  doc.fillColor('#000');

  doc.y = 112;
  doc.font('Helvetica').fontSize(9).fillColor('#6b7280')
    .text(`${center?.name || invoice.center_id}   |   Invoice date ${pdfDate(invoice.invoice_date)}   |   Recorded by ${invoice.created_by || '-'} on ${pdfDate(invoice.created_at)}`, 50, doc.y);
  doc.fillColor('#000');
  doc.font('Helvetica').fontSize(8).fillColor('#9ca3af')
    .text('This is a system record of the invoice, not the original vendor document.', 50, doc.y + 13);
  doc.fillColor('#000');
  doc.y += 30;

  pdfSectionTitle(doc, 'Invoice Details');
  pdfFieldGrid(doc, [
    ['Vendor / Party', invoice.vendor_name], ['Invoice Date', pdfDate(invoice.invoice_date)],
    ['Project', invoice.project_name], ['Business Head / Department', invoice.business_head_name],
    ['Center', center?.name || invoice.center_id], ['Recorded By', invoice.created_by],
  ]);

  pdfSectionTitle(doc, 'Line Items');
  const colX = { name: 50, qty: 275, price: 325, gst: 390, total: 440 };
  const headY = doc.y;
  doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#17355f');
  doc.text('Item', colX.name, headY, { width: 220 });
  doc.text('Qty', colX.qty, headY, { width: 45 });
  doc.text('Unit Price', colX.price, headY, { width: 60 });
  doc.text('GST %', colX.gst, headY, { width: 45 });
  doc.text('Total', colX.total, headY, { width: 105, align: 'right' });
  doc.moveTo(50, doc.y + 13).lineTo(545, doc.y + 13).strokeColor('#dbe3f0').stroke();
  doc.moveDown(1.1);
  doc.fillColor('#000');

  invoice.lineItems.forEach(li => {
    const rowY = doc.y;
    doc.font('Helvetica').fontSize(9);
    doc.text(`${li.asset_name} (${li.classification_name})`, colX.name, rowY, { width: 220 });
    doc.text(`${li.bill_quantity} ${li.unit || 'pcs'}`, colX.qty, rowY, { width: 45 });
    doc.text(li.unit_price != null ? pdfMoney(li.unit_price) : '-', colX.price, rowY, { width: 60 });
    doc.text(`${li.gst_percent}%`, colX.gst, rowY, { width: 45 });
    doc.font('Helvetica-Bold').text(li.total_value != null ? pdfMoney(li.total_value) : '-', colX.total, rowY, { width: 105, align: 'right' });
    doc.moveDown(1);
    if (li.assets.length) {
      doc.font('Helvetica').fontSize(7.5).fillColor('#475569')
        .text(`Asset tags: ${li.assets.map(a => a.asset_tag).join(', ')}`, colX.name, doc.y, { width: 495 });
      doc.fillColor('#000');
      doc.moveDown(0.6);
    }
    doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#f1f5f9').stroke();
    doc.moveDown(0.4);
  });

  doc.moveDown(0.4);
  const totals = [
    ['Taxable Value', invoice.taxable_value],
    ['GST Value', invoice.gst_value],
    ['Installation Charges', invoice.installation_charges],
    ['Freight Charges', invoice.freight_charges],
  ];
  doc.fontSize(10);
  totals.forEach(([label, value]) => {
    doc.font('Helvetica').fillColor('#374151').text(`${label}:  ${pdfMoney(value)}`, { align: 'right' });
    doc.moveDown(0.3);
  });

  doc.moveDown(0.3);
  const totalBoxY = doc.y;
  doc.rect(345, totalBoxY, 200, 34).fill('#eef2ff');
  doc.fillColor('#2d2a6e').font('Helvetica-Bold').fontSize(9).text('TOTAL BILL VALUE', 355, totalBoxY + 7, { width: 180, align: 'right' });
  doc.fontSize(15).text(pdfMoney(invoice.total_bill_value), 355, totalBoxY + 17, { width: 180, align: 'right' });
  doc.fillColor('#000');
  doc.y = totalBoxY + 46;

  doc.moveDown(1);
  doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#e2e8f0').stroke();
  doc.moveDown(0.5);
  doc.font('Helvetica').fontSize(7.5).fillColor('#9ca3af')
    .text(`This is a system-generated record from ${getOrgShortName()} (${getOrgName()} Inventory Management System).`, 50, doc.y, { width: 495 });

  doc.end();
});

// Mandatory fields per VERSION_2_PLAN.md requirement 1.
const REQUIRED_INVOICE_FIELDS = ['vendorName', 'invoiceNumber', 'invoiceDate', 'projectName', 'businessHeadName'];
const REQUIRED_LINE_ITEM_FIELDS = ['classificationId', 'assetName', 'billQuantity', 'unitPrice'];

router.post('/', authMiddleware, superAdminOnly, (req, res) => {
  const db = getDb();
  const centerId = getRequestedCenterId(req);
  let center;
  try {
    center = requireCenter(centerId);
  } catch {
    return res.status(400).json({ message: 'A valid center is required' });
  }

  const body = req.body || {};
  const missing = REQUIRED_INVOICE_FIELDS.filter(field => !String(body[field] || '').trim());
  if (missing.length) {
    return res.status(400).json({ message: `Missing required field(s): ${missing.join(', ')}` });
  }
  const lineItemsInput = Array.isArray(body.lineItems) ? body.lineItems : [];
  if (!lineItemsInput.length) {
    return res.status(400).json({ message: 'At least one line item is required' });
  }
  for (const [idx, li] of lineItemsInput.entries()) {
    const missingLi = REQUIRED_LINE_ITEM_FIELDS.filter(field => li[field] === undefined || li[field] === null || li[field] === '');
    if (missingLi.length) {
      return res.status(400).json({ message: `Line item ${idx + 1} missing: ${missingLi.join(', ')}` });
    }
    if (Number(li.billQuantity) <= 0) {
      return res.status(400).json({ message: `Line item ${idx + 1}: Bill Quantity must be greater than 0` });
    }
  }

  const existingInvoice = db.prepare('SELECT id FROM invoices WHERE center_id = ? AND invoice_number = ?')
    .get(center.id, String(body.invoiceNumber).trim());
  if (existingInvoice) {
    return res.status(409).json({ message: `Invoice number ${body.invoiceNumber} already exists for ${center.name}` });
  }

  const installationCharges = Number(body.installationCharges) || 0;
  const freightCharges = Number(body.freightCharges) || 0;

  const nextAssetTag = createAssetTagGenerator(db);

  db.exec('BEGIN TRANSACTION');
  try {
    const vendorId = getOrCreateByName(db, 'vendors', body.vendorName);
    const businessHeadId = getOrCreateByName(db, 'business_heads', body.businessHeadName);
    const projectId = getOrCreateProject(db, center.id, body.projectName);

    let taxableTotal = 0;
    let gstTotal = 0;
    const computedLineItems = lineItemsInput.map(li => {
      const billQuantity = Number(li.billQuantity);
      const unitPrice = Number(li.unitPrice);
      const gstPercent = Number(li.gstPercent) || 0;
      const taxableValue = billQuantity * unitPrice;
      const gstValue = taxableValue * (gstPercent / 100);
      taxableTotal += taxableValue;
      gstTotal += gstValue;
      const hasWarranty = !!li.hasWarranty;
      const warrantyUntil = hasWarranty ? String(li.warrantyUntil || '').trim() : null;
      if (hasWarranty && !warrantyUntil) {
        throw Object.assign(new Error(`${li.assetName || 'Line item'}: warranty end date is required when "Has warranty" is checked`), { code: 'VALIDATION' });
      }
      return { ...li, billQuantity, unitPrice, gstPercent, taxableValue, gstValue, totalValue: taxableValue + gstValue, hasWarranty, warrantyUntil };
    });
    // GST applies to line items only; installation/freight are added untaxed on top.
    const totalBillValue = taxableTotal + gstTotal + installationCharges + freightCharges;

    const invoiceId = db.prepare(`
      INSERT INTO invoices
        (center_id, invoice_number, invoice_date, vendor_id, project_id, business_head_id,
         installation_charges, freight_charges, taxable_value, gst_value, total_bill_value, is_legacy, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    `).run(
      center.id, String(body.invoiceNumber).trim(), body.invoiceDate, vendorId, projectId, businessHeadId,
      installationCharges, freightCharges, taxableTotal, gstTotal, totalBillValue, req.user.username
    ).lastInsertRowid;

    const insertLineItem = db.prepare(`
      INSERT INTO invoice_line_items
        (invoice_id, classification_id, asset_name, bill_quantity, unit, unit_price,
         taxable_value, gst_percent, gst_value, total_value, purchased_for, has_warranty, warranty_until)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const insertAsset = db.prepare(`
      INSERT INTO assets
        (id, asset_tag, center_id, catalog_id, invoice_line_item_id, classification_id, name,
         description, unit, unit_value, serial_number, location, status, is_legacy, active, added_date, image,
         has_warranty, warranty_until, needs_label)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', 0, 1, ?, ?, ?, ?, ?)
    `);
    const insertEvent = db.prepare(`
      INSERT INTO asset_lifecycle_events (asset_id, event_type, from_status, to_status, center_id, notes, performed_by, occurred_at)
      VALUES (?, 'procured', NULL, 'available', ?, 'Procured via invoice entry', ?, ?)
    `);

    const createdLineItems = [];
    const now = new Date().toISOString();
    const classificationRows = new Map();
    for (const li of computedLineItems) {
      if (!classificationRows.has(li.classificationId)) {
        classificationRows.set(li.classificationId, db.prepare('SELECT id, name FROM classifications WHERE id = ?').get(li.classificationId));
      }
      const classification = classificationRows.get(li.classificationId);
      if (!classification) throw new Error(`Unknown classification id ${li.classificationId}`);

      const lineItemId = insertLineItem.run(
        invoiceId, li.classificationId, li.assetName, li.billQuantity, li.unit || 'pcs', li.unitPrice,
        li.taxableValue, li.gstPercent, li.gstValue, li.totalValue, li.purchasedFor || null,
        li.hasWarranty ? 1 : 0, li.warrantyUntil
      ).lastInsertRowid;

      const catalogId = getOrCreateCatalog(db, center.id, li.assetName, li.classificationId, li.unit, li.image, li.description);
      const catalogTagCode = db.prepare('SELECT tag_code FROM product_catalog WHERE id = ?').get(catalogId)?.tag_code;
      // Asset tags are always generated; manufacturer serial numbers are
      // optional and only recorded when the form supplied them (one per
      // unit, in order). A single shared reference ("bulk") applies to all.
      const isBulk = !!li.isBulk;
      const providedSerials = Array.isArray(li.serialNumbers) ? li.serialNumbers : [];
      const bulkReference = isBulk ? (providedSerials[0] || null) : null;
      const needsLabel = li.printLabels === false ? 0 : 1;
      const assets = [];
      for (let unitIndex = 0; unitIndex < li.billQuantity; unitIndex += 1) {
        const assetId = crypto.randomUUID();
        const assetTag = nextAssetTag(center.code, center.id, li.classificationId, classification.name, catalogId, catalogTagCode);
        const serialNumber = isBulk ? bulkReference : (providedSerials[unitIndex] || null);
        insertAsset.run(
          assetId, assetTag, center.id, catalogId, lineItemId, li.classificationId, li.assetName,
          null, li.unit || 'pcs', li.unitPrice, serialNumber, null, now, null,
          li.hasWarranty ? 1 : 0, li.warrantyUntil, needsLabel
        );
        insertEvent.run(assetId, center.id, req.user.username, now);
        assets.push({ id: assetId, assetTag, serialNumber, needsLabel: needsLabel === 1 });
      }
      createdLineItems.push({ id: lineItemId, ...li, assets });
    }

    db.exec('COMMIT');
    res.status(201).json({
      id: invoiceId, centerId: center.id, invoiceNumber: body.invoiceNumber, taxableValue: taxableTotal,
      gstValue: gstTotal, installationCharges, freightCharges, totalBillValue, lineItems: createdLineItems,
    });
  } catch (err) {
    db.exec('ROLLBACK');
    res.status(400).json({ message: err.message });
  }
});

// Edit an invoice: header fields, and per-line-item price/GST/quantity/photo
// corrections. Quantity increases add new asset units (same as creation);
// quantity decreases only succeed if enough units are still "available" to
// remove -- units already issued/damaged/etc. are never silently deleted.
router.put('/:id', authMiddleware, superAdminOnly, (req, res) => {
  const db = getDb();
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!invoice) return res.status(404).json({ message: 'Invoice not found' });

  const center = requireCenter(invoice.center_id);
  const body = req.body || {};
  const allUpdates = Array.isArray(body.lineItems) ? body.lineItems : [];
  const lineItemUpdates = allUpdates.filter(u => u.id !== undefined && u.id !== null && u.id !== '');
  const newLineItemsInput = allUpdates.filter(u => u.id === undefined || u.id === null || u.id === '');
  const existingLineItems = db.prepare('SELECT * FROM invoice_line_items WHERE invoice_id = ?').all(invoice.id);
  const existingById = new Map(existingLineItems.map(li => [li.id, li]));

  for (const update of lineItemUpdates) {
    if (!existingById.has(Number(update.id))) {
      return res.status(400).json({ message: `Line item ${update.id} does not belong to this invoice` });
    }
  }
  for (const [idx, li] of newLineItemsInput.entries()) {
    const missing = ['classificationId', 'assetName', 'billQuantity', 'unitPrice'].filter(f => li[f] === undefined || li[f] === null || li[f] === '');
    if (missing.length) {
      return res.status(400).json({ message: `New line item ${idx + 1} missing: ${missing.join(', ')}` });
    }
  }

  const nextAssetTag = createAssetTagGenerator(db);

  db.exec('BEGIN TRANSACTION');
  try {
    const vendorId = body.vendorName !== undefined ? getOrCreateByName(db, 'vendors', body.vendorName) : invoice.vendor_id;
    const businessHeadId = body.businessHeadName !== undefined ? getOrCreateByName(db, 'business_heads', body.businessHeadName) : invoice.business_head_id;
    const projectId = body.projectName !== undefined ? getOrCreateProject(db, center.id, body.projectName) : invoice.project_id;
    const installationCharges = body.installationCharges !== undefined ? Number(body.installationCharges) || 0 : invoice.installation_charges;
    const freightCharges = body.freightCharges !== undefined ? Number(body.freightCharges) || 0 : invoice.freight_charges;

    let taxableTotal = 0;
    let gstTotal = 0;

    for (const li of existingLineItems) {
      const update = lineItemUpdates.find(u => Number(u.id) === li.id);
      const unitPrice = update?.unitPrice !== undefined ? Number(update.unitPrice) : li.unit_price;
      const gstPercent = update?.gstPercent !== undefined ? Number(update.gstPercent) || 0 : li.gst_percent;
      const purchasedFor = update?.purchasedFor !== undefined ? update.purchasedFor : li.purchased_for;
      const newQuantity = update?.billQuantity !== undefined ? Number(update.billQuantity) : li.bill_quantity;
      const hasWarranty = update?.hasWarranty !== undefined ? !!update.hasWarranty : !!li.has_warranty;
      const warrantyUntil = hasWarranty ? String((update?.warrantyUntil !== undefined ? update.warrantyUntil : li.warranty_until) || '').trim() : null;
      if (hasWarranty && !warrantyUntil) {
        throw new Error(`${li.asset_name}: warranty end date is required when "Has warranty" is checked`);
      }
      if (hasWarranty !== !!li.has_warranty || warrantyUntil !== li.warranty_until) {
        db.prepare('UPDATE assets SET has_warranty = ?, warranty_until = ? WHERE invoice_line_item_id = ?')
          .run(hasWarranty ? 1 : 0, warrantyUntil, li.id);
      }

      if (newQuantity !== li.bill_quantity) {
        if (newQuantity > li.bill_quantity) {
          const toAdd = newQuantity - li.bill_quantity;
          const classification = db.prepare('SELECT id, name FROM classifications WHERE id = ?').get(li.classification_id);
          const isBulk = !!update?.isBulk;
          const providedSerials = Array.isArray(update.serialNumbers) ? update.serialNumbers : [];
          const bulkReference = isBulk ? (providedSerials[0] || null) : null;
          // New units follow the line item's existing units unless the form
          // says otherwise, so topping up a reel of resistors stays unlabelled.
          const siblingLabel = db.prepare('SELECT needs_label FROM assets WHERE invoice_line_item_id = ? LIMIT 1').get(li.id);
          const needsLabel = update.printLabels === undefined
            ? (siblingLabel ? siblingLabel.needs_label : 1)
            : (update.printLabels === false ? 0 : 1);
          // Prefer the catalog an existing unit from this SAME line item is
          // already grouped under -- authoritative regardless of any name
          // drift -- and only fall back to a name lookup if this line item
          // somehow has no units yet (shouldn't happen; bill_quantity was
          // already > 0 to exist at all).
          const linkedAsset = db.prepare('SELECT catalog_id FROM assets WHERE invoice_line_item_id = ? AND catalog_id IS NOT NULL LIMIT 1').get(li.id);
          const catalogRow = linkedAsset
            ? db.prepare('SELECT id, tag_code FROM product_catalog WHERE id = ?').get(linkedAsset.catalog_id)
            : db.prepare('SELECT id, tag_code FROM product_catalog WHERE center_id = ? AND name = ?').get(center.id, li.asset_name);
          for (let i = 0; i < toAdd; i += 1) {
            const assetId = crypto.randomUUID();
            const assetTag = nextAssetTag(center.code, center.id, li.classification_id, classification.name, catalogRow?.id, catalogRow?.tag_code);
            const serialNumber = isBulk ? bulkReference : (providedSerials[i] || null);
            db.prepare(`
              INSERT INTO assets
                (id, asset_tag, center_id, catalog_id, invoice_line_item_id, classification_id, name,
                 unit, unit_value, serial_number, status, is_legacy, active, added_date, has_warranty, warranty_until, needs_label)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', 0, 1, ?, ?, ?, ?)
            `).run(assetId, assetTag, center.id, catalogRow?.id || null, li.id, li.classification_id, li.asset_name,
                   li.unit, unitPrice, serialNumber, new Date().toISOString(), hasWarranty ? 1 : 0, warrantyUntil, needsLabel);
            db.prepare(`
              INSERT INTO asset_lifecycle_events (asset_id, event_type, from_status, to_status, center_id, notes, performed_by)
              VALUES (?, 'procured', NULL, 'available', ?, 'Added via invoice edit (quantity increase)', ?)
            `).run(assetId, center.id, req.user.username);
          }
        } else {
          const toRemove = li.bill_quantity - newQuantity;
          const removable = db.prepare(`
            SELECT id FROM assets WHERE invoice_line_item_id = ? AND status = 'available' LIMIT ?
          `).all(li.id, toRemove);
          if (removable.length < toRemove) {
            throw new Error(`Cannot reduce "${li.asset_name}" quantity by ${toRemove}: only ${removable.length} unit(s) are still "available" (the rest have already been issued, damaged, or otherwise moved).`);
          }
          for (const row of removable) {
            db.prepare('DELETE FROM asset_lifecycle_events WHERE asset_id = ?').run(row.id);
            db.prepare('DELETE FROM assets WHERE id = ?').run(row.id);
          }
        }
      }

      if (unitPrice !== li.unit_price) {
        db.prepare('UPDATE assets SET unit_value = ? WHERE invoice_line_item_id = ?').run(unitPrice, li.id);
      }
      if (update?.image || update?.description) {
        getOrCreateCatalog(db, center.id, li.asset_name, li.classification_id, li.unit, update.image, update.description);
      }

      const taxableValue = newQuantity * unitPrice;
      const gstValue = taxableValue * (gstPercent / 100);
      taxableTotal += taxableValue;
      gstTotal += gstValue;

      db.prepare(`
        UPDATE invoice_line_items
        SET bill_quantity = ?, unit_price = ?, gst_percent = ?, taxable_value = ?, gst_value = ?, total_value = ?, purchased_for = ?,
            has_warranty = ?, warranty_until = ?
        WHERE id = ?
      `).run(newQuantity, unitPrice, gstPercent, taxableValue, gstValue, taxableValue + gstValue, purchasedFor || null,
             hasWarranty ? 1 : 0, warrantyUntil, li.id);
    }

    // Genuinely new line items added while editing (no matching id) -- same
    // creation logic as POST /api/invoices, scoped to this existing invoice.
    for (const li of newLineItemsInput) {
      const classification = db.prepare('SELECT id, name FROM classifications WHERE id = ?').get(Number(li.classificationId));
      if (!classification) throw new Error(`Unknown classification id ${li.classificationId}`);

      const billQuantity = Number(li.billQuantity);
      const unitPrice = Number(li.unitPrice);
      const gstPercent = Number(li.gstPercent) || 0;
      const taxableValue = billQuantity * unitPrice;
      const gstValue = taxableValue * (gstPercent / 100);
      taxableTotal += taxableValue;
      gstTotal += gstValue;
      const hasWarranty = !!li.hasWarranty;
      const warrantyUntil = hasWarranty ? String(li.warrantyUntil || '').trim() : null;
      if (hasWarranty && !warrantyUntil) {
        throw new Error(`${li.assetName}: warranty end date is required when "Has warranty" is checked`);
      }

      const lineItemId = db.prepare(`
        INSERT INTO invoice_line_items
          (invoice_id, classification_id, asset_name, bill_quantity, unit, unit_price,
           taxable_value, gst_percent, gst_value, total_value, purchased_for, has_warranty, warranty_until)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(invoice.id, Number(li.classificationId), li.assetName, billQuantity, li.unit || 'pcs', unitPrice,
             taxableValue, gstPercent, gstValue, taxableValue + gstValue, li.purchasedFor || null,
             hasWarranty ? 1 : 0, warrantyUntil).lastInsertRowid;

      const catalogId = getOrCreateCatalog(db, center.id, li.assetName, Number(li.classificationId), li.unit, li.image, li.description);
      const catalogTagCode = db.prepare('SELECT tag_code FROM product_catalog WHERE id = ?').get(catalogId)?.tag_code;
      const isBulk = !!li.isBulk;
      const providedSerials = Array.isArray(li.serialNumbers) ? li.serialNumbers : [];
      const bulkReference = isBulk ? (providedSerials[0] || null) : null;
      const needsLabel = li.printLabels === false ? 0 : 1;
      const now = new Date().toISOString();
      for (let i = 0; i < billQuantity; i += 1) {
        const assetId = crypto.randomUUID();
        const assetTag = nextAssetTag(center.code, center.id, Number(li.classificationId), classification.name, catalogId, catalogTagCode);
        const serialNumber = isBulk ? bulkReference : (providedSerials[i] || null);
        db.prepare(`
          INSERT INTO assets
            (id, asset_tag, center_id, catalog_id, invoice_line_item_id, classification_id, name,
             unit, unit_value, serial_number, status, is_legacy, active, added_date, has_warranty, warranty_until, needs_label)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', 0, 1, ?, ?, ?, ?)
        `).run(assetId, assetTag, center.id, catalogId, lineItemId, Number(li.classificationId), li.assetName,
               li.unit || 'pcs', unitPrice, serialNumber, now, hasWarranty ? 1 : 0, warrantyUntil, needsLabel);
        db.prepare(`
          INSERT INTO asset_lifecycle_events (asset_id, event_type, from_status, to_status, center_id, notes, performed_by, occurred_at)
          VALUES (?, 'procured', NULL, 'available', ?, 'Added via invoice edit (new line item)', ?, ?)
        `).run(assetId, center.id, req.user.username, now);
      }
    }

    const totalBillValue = taxableTotal + gstTotal + installationCharges + freightCharges;
    db.prepare(`
      UPDATE invoices
      SET vendor_id = ?, invoice_date = ?, project_id = ?, business_head_id = ?,
          installation_charges = ?, freight_charges = ?, taxable_value = ?, gst_value = ?, total_bill_value = ?
      WHERE id = ?
    `).run(
      vendorId, body.invoiceDate !== undefined ? body.invoiceDate : invoice.invoice_date, projectId, businessHeadId,
      installationCharges, freightCharges, taxableTotal, gstTotal, totalBillValue, invoice.id
    );

    db.exec('COMMIT');
    res.json(loadInvoiceDetail(db, invoice.id));
  } catch (err) {
    db.exec('ROLLBACK');
    res.status(400).json({ message: err.message });
  }
});

// Only safe to delete if nothing generated from this invoice has moved past
// "available" -- otherwise real usage history (issues, damage, repairs)
// would be silently destroyed.
router.delete('/:id', authMiddleware, superAdminOnly, (req, res) => {
  const db = getDb();
  const invoice = db.prepare('SELECT * FROM invoices WHERE id = ?').get(req.params.id);
  if (!invoice) return res.status(404).json({ message: 'Invoice not found' });

  const lineItemIds = db.prepare('SELECT id FROM invoice_line_items WHERE invoice_id = ?').all(invoice.id).map(r => r.id);
  const placeholders = lineItemIds.map(() => '?').join(',') || 'NULL';
  const movedAssets = lineItemIds.length
    ? db.prepare(`SELECT COUNT(*) c FROM assets WHERE invoice_line_item_id IN (${placeholders}) AND status != 'available'`).get(...lineItemIds)
    : { c: 0 };

  if (movedAssets.c > 0) {
    return res.status(400).json({
      message: `Cannot delete invoice ${invoice.invoice_number}: ${movedAssets.c} unit(s) generated from it have already been issued, damaged, or otherwise moved. Correct the invoice instead, or resolve those units first.`,
    });
  }

  db.exec('BEGIN TRANSACTION');
  try {
    const assetIds = lineItemIds.length
      ? db.prepare(`SELECT id FROM assets WHERE invoice_line_item_id IN (${placeholders})`).all(...lineItemIds).map(r => r.id)
      : [];
    for (const assetId of assetIds) {
      db.prepare('DELETE FROM asset_lifecycle_events WHERE asset_id = ?').run(assetId);
      db.prepare('DELETE FROM assets WHERE id = ?').run(assetId);
    }
    db.prepare('DELETE FROM invoice_line_items WHERE invoice_id = ?').run(invoice.id);
    db.prepare('DELETE FROM invoices WHERE id = ?').run(invoice.id);
    db.exec('COMMIT');
    res.json({ deleted: true, assetsRemoved: assetIds.length });
  } catch (err) {
    db.exec('ROLLBACK');
    res.status(400).json({ message: err.message });
  }
});

module.exports = router;
