// Full reset + rebuild of JP Nagar from the July 2026 stock audit spreadsheet.
//
// Unlike import-jp-nagar-july2026.js (which only added items NOT already in
// the system), this script:
//   1. Deletes ALL existing JP Nagar data (catalog, assets, lifecycle
//      events, invoices, programs) -- the spreadsheet becomes the sole
//      source of truth for this center, per explicit instruction.
//   2. Rebuilds every usable row's FULL history: original quantity
//      purchased, how much was lost in each of the 3 audit periods
//      (original->July2024, July2024->~June2025, ~June2025->July2026), and
//      what remains available today -- not just the final snapshot.
//   3. "Interior Furnishing" rows (civil/interior-fitout work measured in
//      sqft, not lendable inventory) become ONE fixed, non-exploded asset
//      per line item, valued at the full scope amount -- not per-unit
//      lifecycle reconstruction like everything else. Keeps total value
//      reconciling with the sheet without pretending painted walls are
//      100s of individually lendable "units".
//
// Each historically-lost unit gets its own asset_tag and a real lifecycle:
// procured -> damaged, dated at the audit checkpoint where the loss was
// detected (exact date within that window is not knowable from the source
// data, and the notes say so explicitly). Deliberately stops at 'damaged',
// not 'disposed' -- these are audit-detected losses, not confirmed
// write-offs; an admin reviews and moves each one to disposed/under_repair
// manually via the app.
//
// Usage: node rebuild-jp-nagar-full-history.js <db-path> <parsed-rows.json> [--apply]
// Without --apply, only the SQL portion runs inside a transaction that gets
// ROLLED BACK at the end and a report is printed -- a true dry run. Pass
// --apply to commit for real. Always run without --apply against a COPY
// first.

const crypto = require('crypto');
const { openDatabase } = require('../utils/db');
const { requireCenter } = require('./legacy-centers');
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
  // Civil/interior-fitout work (painting, flooring, partitions -- measured
  // in sqft, not discrete lendable units). Modeled as ONE fixed,
  // non-exploded asset per line item (see FIXED_INFRASTRUCTURE_CLASSIFICATIONS
  // below), not the per-unit lifecycle reconstruction other rows get.
  'interior furnishing': 'Interior infrastructure',
};

const CONSUMABLE_CLASSIFICATIONS = new Set(['single use consumables', 'plywood and hardware']);
const FIXED_INFRASTRUCTURE_CLASSIFICATIONS = new Set(['interior furnishing']);

const PERIOD_LABELS = [
  { key: 'period1', date: '2024-07-06', desc: 'between the original purchase and the July 2024 stock audit' },
  { key: 'period2', date: '2025-06-20', desc: 'between the July 2024 and ~June 2025 stock audits' },
  { key: 'period3', date: '2026-07-01', desc: 'between the ~2025 stock audit and the July 2026 stock audit' },
];

function normalizeName(s) {
  return String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function deleteExistingJpNagarData(db, centerId) {
  const counts = {};
  counts.lifecycleEvents = db.prepare(`
    DELETE FROM asset_lifecycle_events WHERE asset_id IN (SELECT id FROM assets WHERE center_id = ?)
  `).run(centerId).changes;
  counts.assets = db.prepare('DELETE FROM assets WHERE center_id = ?').run(centerId).changes;
  counts.lineItems = db.prepare(`
    DELETE FROM invoice_line_items WHERE invoice_id IN (SELECT id FROM invoices WHERE center_id = ?)
  `).run(centerId).changes;
  counts.invoices = db.prepare('DELETE FROM invoices WHERE center_id = ?').run(centerId).changes;
  // Dormant Phase-0-migration table (the live app uses orders.xlsx for
  // student issue/return, not this SQL table) -- a handful of rows survive
  // from the original migration validation and reference product_catalog,
  // blocking its deletion below. These ARE the "2 student orders" the reset
  // covers.
  counts.issueRecordAssets = db.prepare(`
    DELETE FROM issue_record_assets WHERE issue_record_item_id IN (
      SELECT iri.id FROM issue_record_items iri
      JOIN issue_records ir ON ir.id = iri.issue_record_id
      WHERE ir.center_id = ?
    )
  `).run(centerId).changes;
  counts.orderReturnItems = db.prepare(`
    DELETE FROM order_return_items WHERE issue_record_item_id IN (
      SELECT iri.id FROM issue_record_items iri
      JOIN issue_records ir ON ir.id = iri.issue_record_id
      WHERE ir.center_id = ?
    )
  `).run(centerId).changes;
  counts.issueRecordItems = db.prepare(`
    DELETE FROM issue_record_items WHERE issue_record_id IN (SELECT id FROM issue_records WHERE center_id = ?)
  `).run(centerId).changes;
  counts.issueRecords = db.prepare('DELETE FROM issue_records WHERE center_id = ?').run(centerId).changes;
  counts.catalog = db.prepare('DELETE FROM product_catalog WHERE center_id = ?').run(centerId).changes;
  counts.programs = db.prepare('DELETE FROM projects WHERE center_id = ?').run(centerId).changes;
  return counts;
}

function computeRowQuantities(r) {
  const J = r.billQty;
  const T = r.blockTwoFinal;
  const AB = r.periodTwoConsumed || 0;
  const AK = r.periodThreeConsumed || 0;

  let originalQty;
  let afterP1;
  let period1Loss;
  if (J !== null) {
    originalQty = J;
    afterP1 = T !== null ? T : J;
    period1Loss = originalQty - afterP1;
  } else if (T !== null) {
    originalQty = T;
    afterP1 = T;
    period1Loss = 0;
  } else {
    return null;
  }
  const period2Loss = AB;
  const afterP2 = afterP1 - AB;
  const period3Loss = AK;
  const afterP3 = afterP2 - AK;

  const flooredOriginal = Math.floor(originalQty);
  const flooredLoss1 = Math.max(0, Math.floor(period1Loss));
  const flooredLoss2 = Math.max(0, Math.floor(period2Loss));
  const flooredLoss3 = Math.max(0, Math.floor(period3Loss));
  const available = Math.max(0, flooredOriginal - flooredLoss1 - flooredLoss2 - flooredLoss3);

  return { originalQty: flooredOriginal, period1Loss: flooredLoss1, period2Loss: flooredLoss2, period3Loss: flooredLoss3, available };
}

function rebuild(dbPath, rows, { apply = false } = {}) {
  const db = openDatabase(dbPath);
  const center = requireCenter('jp_nagar');

  const classifications = db.prepare('SELECT id, name FROM classifications').all();
  const classIdByName = new Map(classifications.map(c => [c.name, c.id]));
  const classById = new Map(classifications.map(c => [c.id, c]));

  const report = {
    deleted: null,
    totalRows: rows.length,
    fixedInfrastructureItemsCreated: 0,
    skippedNoUsableQty: 0,
    unknownClassification: [],
    lineItemsCreated: 0,
    invoicesCreated: 0,
    assetsCreated: 0,
    assetsAvailable: 0,
    assetsDamagedHistorical: 0,
    totalOriginalUnitsAcrossHistory: 0,
    fatalError: null,
  };

  const usable = [];
  for (const r of rows) {
    if (!r.name) continue;
    const classificationKey = normalizeName(r.classification);
    const isFixedInfrastructure = FIXED_INFRASTRUCTURE_CLASSIFICATIONS.has(classificationKey);

    let q;
    if (isFixedInfrastructure) {
      // No per-unit loss history for civil work -- one fixed asset, valued
      // at the full (unfloored) original scope so the real rupee value
      // survives even though physical "quantity" (sqft) doesn't map to
      // discrete lendable units.
      if (!r.billQty || r.billQty <= 0) {
        report.skippedNoUsableQty += 1;
        continue;
      }
      q = { originalQty: 1, period1Loss: 0, period2Loss: 0, period3Loss: 0, available: 1,
            fixedTotalValue: r.billQty * (r.unitPrice || 0) };
    } else {
      q = computeRowQuantities(r);
      if (!q || q.originalQty <= 0) {
        report.skippedNoUsableQty += 1;
        continue;
      }
    }

    const mappedClassName = CLASSIFICATION_MAP[classificationKey];
    if (mappedClassName === undefined) {
      report.unknownClassification.push({ row: r.row, name: r.name, classification: r.classification });
      continue;
    }
    usable.push({ ...r, ...q, classificationId: classIdByName.get(mappedClassName), classificationKey, isFixedInfrastructure });
  }

  const groups = new Map();
  for (const r of usable) {
    const key = `${r.vendor || 'Unknown'}::${r.invoiceNo || 'NA'}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  db.exec('BEGIN TRANSACTION');
  try {
    report.deleted = deleteExistingJpNagarData(db, center.id);

    function getOrCreateByName(table, name) {
      const trimmed = String(name || '').trim();
      if (!trimmed) return null;
      const existing = db.prepare(`SELECT id FROM ${table} WHERE name = ?`).get(trimmed);
      if (existing) return existing.id;
      return db.prepare(`INSERT INTO ${table} (name) VALUES (?)`).run(trimmed).lastInsertRowid;
    }
    function getOrCreateCatalog(name, classificationId) {
      const existing = db.prepare('SELECT id FROM product_catalog WHERE center_id = ? AND name = ?').get(center.id, name);
      if (existing) return existing.id;
      return db.prepare(`
        INSERT INTO product_catalog (center_id, name, classification_id, unit) VALUES (?, ?, ?, 'pcs')
      `).run(center.id, name, classificationId).lastInsertRowid;
    }

    const nextAssetTag = createAssetTagGenerator(db);
    const insertAsset = db.prepare(`
      INSERT INTO assets
        (id, asset_tag, center_id, catalog_id, invoice_line_item_id, classification_id, name, description,
         unit, unit_value, serial_number, status, is_legacy, active, added_date)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pcs', ?, ?, ?, 1, 1, ?)
    `);
    const insertEvent = db.prepare(`
      INSERT INTO asset_lifecycle_events (asset_id, event_type, from_status, to_status, center_id, notes, performed_by, occurred_at)
      VALUES (?, ?, ?, ?, ?, ?, 'system:jp_nagar_july2026_audit', ?)
    `);

    let anonSeq = 0;
    for (const items of groups.values()) {
      const first = items[0];
      const vendorId = getOrCreateByName('vendors', first.vendor || 'Unknown Vendor (July 2026 audit)');
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
        // Fixed infrastructure is recorded as qty=1 at the full scope value
        // (not per-sqft), since it becomes a single non-exploded asset.
        const qtyForInvoice = li.isFixedInfrastructure ? 1 : li.originalQty;
        const unitPriceForInvoice = li.isFixedInfrastructure ? li.fixedTotalValue : li.unitPrice;
        const taxable = qtyForInvoice * (unitPriceForInvoice || 0);
        const gst = taxable * ((li.gstPercent || 0) / 100);
        taxableTotal += taxable;
        gstTotal += gst;
        return { ...li, qtyForInvoice, unitPriceForInvoice, taxable, gst };
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
        `).run(invoiceId, li.classificationId, li.name, li.qtyForInvoice, li.unitPriceForInvoice, li.taxable, li.gstPercent, li.gst,
               li.taxable + li.gst, 'JP Nagar July 2026 stock audit').lastInsertRowid;
        report.lineItemsCreated += 1;
        if (li.isFixedInfrastructure) report.fixedInfrastructureItemsCreated += 1;

        const catalogId = getOrCreateCatalog(li.name, li.classificationId);
        const classification = classById.get(li.classificationId);
        const isConsumable = CONSUMABLE_CLASSIFICATIONS.has(li.classificationKey);
        const procuredAt = li.invoiceDate ? `${li.invoiceDate}T00:00:00.000Z` : new Date().toISOString();
        // Some rows record real per-unit serials (e.g. "42-34(Z)", or a
        // comma-separated pair when the row's qty is 2+); assign them in
        // creation order as units are made, across all buckets.
        const serials = li.serialRaw ? li.serialRaw.split(',').map(s => s.trim()).filter(Boolean) : [];
        let serialCursor = 0;
        function nextSerial() {
          return serialCursor < serials.length ? serials[serialCursor++] : null;
        }

        function createUnit(status, lossPeriodIndex) {
          const assetId = crypto.randomUUID();
          const assetTag = nextAssetTag(center.code, center.id, li.classificationId, classification.name, catalogId, null);
          insertAsset.run(assetId, assetTag, center.id, catalogId, lineItemId, li.classificationId, li.name,
                          li.desc || null, li.unitPriceForInvoice, nextSerial(), status, procuredAt);
          insertEvent.run(assetId, 'procured', null, 'available', center.id,
                           'Backfilled from JP Nagar July 2026 stock audit (original procurement)', procuredAt);
          report.assetsCreated += 1;
          if (lossPeriodIndex === null) {
            report.assetsAvailable += 1;
            return;
          }
          const period = PERIOD_LABELS[lossPeriodIndex];
          const reason = isConsumable
            ? `Consumed/used in normal project or workshop activity ${period.desc}`
            : `Marked unavailable during stock audit reconciliation, ${period.desc} (exact reason not recorded in source data)`;
          const ts = `${period.date}T00:00:00.000Z`;
          // Stop at 'damaged', not 'disposed' -- these are audit-detected
          // losses, not confirmed write-offs. An admin reviews each one and
          // moves it to disposed/under_repair themselves via the app.
          insertEvent.run(assetId, 'damaged', 'available', 'damaged', center.id, `${reason}. Exact date within this window is not known.`, ts);
          report.assetsDamagedHistorical += 1;
        }

        for (let i = 0; i < li.available; i += 1) createUnit('available', null);
        for (let i = 0; i < li.period1Loss; i += 1) createUnit('damaged', 0);
        for (let i = 0; i < li.period2Loss; i += 1) createUnit('damaged', 1);
        for (let i = 0; i < li.period3Loss; i += 1) createUnit('damaged', 2);

        report.totalOriginalUnitsAcrossHistory += li.originalQty;
      }
    }

    if (apply) {
      db.exec('COMMIT');
      report.applied = true;
    } else {
      db.exec('ROLLBACK');
      report.applied = false;
    }
  } catch (err) {
    db.exec('ROLLBACK');
    report.fatalError = err.message;
    report.applied = false;
  }

  return report;
}

module.exports = { rebuild, computeRowQuantities, normalizeName };

if (require.main === module) {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const [dbPath, rowsPath] = args.filter(a => a !== '--apply');
  if (!dbPath || !rowsPath) {
    console.error('Usage: node rebuild-jp-nagar-full-history.js <db-path> <parsed-rows.json> [--apply]');
    process.exit(1);
  }
  const rows = require(require('path').resolve(rowsPath));
  const report = rebuild(dbPath, rows, { apply });
  console.log(JSON.stringify(report, null, 2));
}
