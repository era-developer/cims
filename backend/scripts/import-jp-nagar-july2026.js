// One-off backfill: JP Nagar's July 2026 physical stock audit
// (JP_Nagar_Center_new_listJuly2026.xlsx), reconciled into the live
// invoice -> line item -> asset model.
//
// Scope, deliberately conservative:
//  - "Interior Furnishing" rows are civil/interior-fitout work (sqft/sqm
//    line items like "Two coats of primer on all walls"), not lendable
//    inventory -- excluded entirely.
//  - Rows whose (normalized) name already matches an existing JP Nagar
//    catalog item are SKIPPED, not reconciled -- automatically adjusting
//    quantities on already-tracked stock risks double-counting against
//    the original v1 migration. They're listed in the report for manual
//    review/top-up via the app instead.
//  - Only genuinely new (unmatched) component types are created, as real
//    invoices (grouped by vendor + invoice number) so procurement history
//    (vendor, GST, price) is preserved, not bare orphan assets.
//  - Fractional final quantities (a handful of bulk-consumable rows) are
//    floored; each one is flagged in the report.
//
// Usage: node import-jp-nagar-july2026.js <path-to-sqlite-db> <path-to-parsed-rows.json>
// Always run against a COPY of the database first and review the report.

const crypto = require('crypto');
const { openDatabase } = require('../utils/db');
const { requireCenter } = require('../utils/centers');
const { createAssetTagGenerator } = require('../utils/assetTag');

const CLASSIFICATION_MAP = {
  'center infrasructure': 'Center Infrastructure',
  'single use consumables': 'Single use Consumables',
  'plywood and hardware': 'Plywood and Hardware',
  'safety tools': 'Safety tools',
  'electronic components': 'Electronic components',
  electronics: 'Electronic components',
  machines: 'Machines',
  'other handtools & spares': 'Other hand tools & Spares',
  'power tools': 'Power tools',
  furniture: 'Furniture',
  'hand tools': 'Hand tools',
  signages: 'Sinages',
  'computers & accessories': 'Computer and accessories',
  'interior furnishing': null, // explicitly excluded, see header comment
};

function normalizeName(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function getOrCreateByName(db, table, name) {
  const trimmed = String(name || '').trim();
  if (!trimmed) return null;
  const existing = db.prepare(`SELECT id FROM ${table} WHERE name = ?`).get(trimmed);
  if (existing) return existing.id;
  return db.prepare(`INSERT INTO ${table} (name) VALUES (?)`).run(trimmed).lastInsertRowid;
}

function getOrCreateCatalog(db, centerId, name, classificationId) {
  const existing = db.prepare('SELECT id FROM product_catalog WHERE center_id = ? AND name = ?').get(centerId, name);
  if (existing) return existing.id;
  return db.prepare(`
    INSERT INTO product_catalog (center_id, name, classification_id, unit) VALUES (?, ?, ?, 'pcs')
  `).run(centerId, name, classificationId).lastInsertRowid;
}

function run(dbPath, rows) {
  const db = openDatabase(dbPath);
  const center = requireCenter('jp_nagar');

  const classifications = db.prepare('SELECT id, name FROM classifications').all();
  const classIdByName = new Map(classifications.map(c => [c.name, c.id]));
  const classById = new Map(classifications.map(c => [c.id, c]));

  const existingCatalog = db.prepare('SELECT id, name FROM product_catalog WHERE center_id = ?').all(center.id);
  const existingByNorm = new Map(existingCatalog.map(c => [normalizeName(c.name), c]));

  const report = {
    totalRows: rows.length,
    skippedInteriorFurnishing: 0,
    skippedZeroOrNullQty: 0,
    skippedMatchedExisting: [],
    flaggedFractionalQty: [],
    unknownClassification: [],
    newCatalogItems: [],
    invoicesCreated: 0,
    assetsCreated: 0,
    fatalError: null,
  };

  const usable = [];
  const seenNames = new Set();
  for (const r of rows) {
    if (normalizeName(r.classification) === 'interior furnishing') {
      report.skippedInteriorFurnishing++;
      continue;
    }
    if (!r.name) continue;
    if (r.finalQty2026 === null || r.finalQty2026 <= 0) {
      report.skippedZeroOrNullQty++;
      continue;
    }
    let qty = r.finalQty2026;
    if (!Number.isInteger(qty)) {
      report.flaggedFractionalQty.push({ name: r.name, rawQty: qty, roundedTo: Math.floor(qty) });
      qty = Math.floor(qty);
      if (qty <= 0) continue;
    }

    const normalized = normalizeName(r.name);
    if (existingByNorm.has(normalized)) {
      report.skippedMatchedExisting.push({ sheetName: r.name, matchedCatalogName: existingByNorm.get(normalized).name, sheetQty: qty });
      continue;
    }

    const mappedClassName = CLASSIFICATION_MAP[normalizeName(r.classification)];
    if (mappedClassName === undefined) {
      report.unknownClassification.push({ row: r.row, name: r.name, classification: r.classification });
      continue;
    }
    const classificationId = classIdByName.get(mappedClassName);
    seenNames.add(normalized);
    usable.push({ ...r, qty, classificationId });
  }

  const groups = new Map();
  for (const r of usable) {
    const key = `${r.vendor || 'Unknown'}::${r.invoiceNo || 'NA'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const nextAssetTag = createAssetTagGenerator(db);

  db.exec('BEGIN TRANSACTION');
  try {
    let anonSeq = 0;
    for (const items of groups.values()) {
      const first = items[0];
      const vendorId = getOrCreateByName(db, 'vendors', first.vendor || 'Unknown Vendor (July 2026 audit)');
      const baseInvoiceNumber = first.invoiceNo || `AUDIT-JUL2026-${++anonSeq}`;
      let invoiceNumber = baseInvoiceNumber;
      let suffix = 0;
      while (db.prepare('SELECT id FROM invoices WHERE center_id = ? AND invoice_number = ?').get(center.id, invoiceNumber)) {
        suffix += 1;
        invoiceNumber = `${baseInvoiceNumber}-AUDIT${suffix}`;
      }

      let taxableTotal = 0;
      let gstTotal = 0;
      const computed = items.map(li => {
        const taxable = li.qty * (li.unitPrice || 0);
        const gst = taxable * ((li.gstPercent || 0) / 100);
        taxableTotal += taxable;
        gstTotal += gst;
        return { ...li, taxable, gst };
      });
      const totalBillValue = taxableTotal + gstTotal;

      const invoiceId = db.prepare(`
        INSERT INTO invoices
          (center_id, invoice_number, invoice_date, vendor_id, taxable_value, gst_value, total_bill_value, is_legacy, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
      `).run(center.id, invoiceNumber, first.invoiceDate || null, vendorId, taxableTotal, gstTotal, totalBillValue,
             'system:jp_nagar_july2026_audit').lastInsertRowid;
      report.invoicesCreated += 1;

      for (const li of computed) {
        const lineItemId = db.prepare(`
          INSERT INTO invoice_line_items
            (invoice_id, classification_id, asset_name, bill_quantity, unit, unit_price, taxable_value, gst_percent, gst_value, total_value, purchased_for)
          VALUES (?, ?, ?, ?, 'pcs', ?, ?, ?, ?, ?, ?)
        `).run(invoiceId, li.classificationId, li.name, li.qty, li.unitPrice, li.taxable, li.gstPercent, li.gst,
               li.taxable + li.gst, 'JP Nagar July 2026 stock audit').lastInsertRowid;

        const catalogId = getOrCreateCatalog(db, center.id, li.name, li.classificationId);
        const classification = classById.get(li.classificationId);
        const now = new Date().toISOString();
        for (let i = 0; i < li.qty; i += 1) {
          const assetId = crypto.randomUUID();
          const assetTag = nextAssetTag(center.code, center.id, li.classificationId, classification.name, catalogId, null);
          db.prepare(`
            INSERT INTO assets
              (id, asset_tag, center_id, catalog_id, invoice_line_item_id, classification_id, name, description,
               unit, unit_value, status, is_legacy, active, added_date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pcs', ?, 'available', 1, 1, ?)
          `).run(assetId, assetTag, center.id, catalogId, lineItemId, li.classificationId, li.name, li.desc || null,
                 li.unitPrice, now);
          db.prepare(`
            INSERT INTO asset_lifecycle_events (asset_id, event_type, from_status, to_status, center_id, notes, performed_by, occurred_at)
            VALUES (?, 'procured', NULL, 'available', ?, 'Backfilled from JP Nagar July 2026 stock audit', 'system:jp_nagar_july2026_audit', ?)
          `).run(assetId, center.id, now);
          report.assetsCreated += 1;
        }
        report.newCatalogItems.push({ name: li.name, qty: li.qty, classification: classification.name, unitPrice: li.unitPrice });
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    report.fatalError = err.message;
  }

  return report;
}

module.exports = { run, normalizeName, CLASSIFICATION_MAP };

if (require.main === module) {
  const [, , dbPath, rowsPath] = process.argv;
  if (!dbPath || !rowsPath) {
    console.error('Usage: node import-jp-nagar-july2026.js <db-path> <parsed-rows.json>');
    process.exit(1);
  }
  const rows = require(require('path').resolve(rowsPath));
  const report = run(dbPath, rows);
  console.log(JSON.stringify(report, null, 2));
}
