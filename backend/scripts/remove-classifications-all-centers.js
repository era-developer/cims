// Generalizes remove-interior-furnishing.js (which only covered JP Nagar's
// "Interior infrastructure" items) to remove BOTH "Interior infrastructure"
// and "Sinages" entirely from ALL 9 centers, per explicit instruction --
// civil/fit-out work and signage boards aren't lendable component
// inventory.
//
// Fixes one thing the original script got wrong: it deleted invoice line
// items without ever adjusting the PARENT invoice's own stored taxable_
// value/gst_value/total_bill_value, leaving those invoices' totals stale
// (still counting the value of a line item that no longer exists) whenever
// the invoice had other, real line items surviving alongside the removed
// one. This version decrements the parent invoice's totals by exactly the
// removed line items' value before deleting them, and only deletes the
// invoice itself once it has zero line items left.
//
// Usage: node remove-classifications-all-centers.js <db-path> [--apply]

const { openDatabase } = require('../utils/db');
const { CENTERS } = require('../utils/centers');

const TARGET_CLASSIFICATIONS = ['Interior infrastructure', 'Sinages'];

function run(dbPath, { apply = false } = {}) {
  const db = openDatabase(dbPath);
  const report = {
    byCenter: {},
    totalCatalogRemoved: 0,
    totalAssetsRemoved: 0,
    totalLifecycleEventsRemoved: 0,
    totalLineItemsRemoved: 0,
    totalInvoicesFullyRemoved: 0,
    totalInvoicesTotalsAdjusted: 0,
    totalValueRemoved: 0,
    applied: false,
    fatalError: null,
  };
  for (const c of CENTERS) {
    report.byCenter[c.id] = { catalogRemoved: 0, assetsRemoved: 0, lineItemsRemoved: 0, invoicesFullyRemoved: 0, valueRemoved: 0 };
  }

  const classIds = db.prepare(`SELECT id, name FROM classifications WHERE name IN (${TARGET_CLASSIFICATIONS.map(() => '?').join(',')})`).all(...TARGET_CLASSIFICATIONS);
  const classIdList = classIds.map(c => c.id);
  if (!classIdList.length) { db.exec('ROLLBACK'); report.fatalError = 'No matching classifications found'; return report; }
  const placeholders = classIdList.map(() => '?').join(',');

  db.exec('BEGIN TRANSACTION');
  try {
    for (const center of CENTERS) {
      const catalogRows = db.prepare(`
        SELECT id, name FROM product_catalog WHERE center_id = ? AND classification_id IN (${placeholders})
      `).all(center.id, ...classIdList);
      if (!catalogRows.length) continue;
      const catalogIds = catalogRows.map(r => r.id);
      const catPlaceholders = catalogIds.map(() => '?').join(',');

      const valueRow = db.prepare(`
        SELECT COALESCE(SUM(unit_value), 0) AS v, COUNT(*) AS c FROM assets WHERE catalog_id IN (${catPlaceholders})
      `).get(...catalogIds);
      report.totalValueRemoved += valueRow.v;
      report.byCenter[center.id].valueRemoved = valueRow.v;

      report.totalLifecycleEventsRemoved += db.prepare(`
        DELETE FROM asset_lifecycle_events WHERE asset_id IN (SELECT id FROM assets WHERE catalog_id IN (${catPlaceholders}))
      `).run(...catalogIds).changes;

      const assetsRemoved = db.prepare(`DELETE FROM assets WHERE catalog_id IN (${catPlaceholders})`).run(...catalogIds).changes;
      report.totalAssetsRemoved += assetsRemoved;
      report.byCenter[center.id].assetsRemoved = assetsRemoved;

      // For each affected invoice, subtract exactly the value of the line
      // items being removed from its own stored totals BEFORE deleting
      // those line items -- keeps invoices.taxable_value/gst_value/
      // total_bill_value always equal to the sum of its (surviving) line
      // items, for invoices that also have real, unrelated line items.
      const affectedInvoices = db.prepare(`
        SELECT DISTINCT li.invoice_id
        FROM invoice_line_items li
        JOIN invoices i ON i.id = li.invoice_id
        WHERE i.center_id = ? AND li.classification_id IN (${placeholders})
      `).all(center.id, ...classIdList);

      for (const { invoice_id } of affectedInvoices) {
        const removedTotals = db.prepare(`
          SELECT COALESCE(SUM(taxable_value), 0) AS taxable, COALESCE(SUM(gst_value), 0) AS gst, COUNT(*) AS c
          FROM invoice_line_items WHERE invoice_id = ? AND classification_id IN (${placeholders})
        `).get(invoice_id, ...classIdList);
        report.totalLineItemsRemoved += removedTotals.c;
        report.byCenter[center.id].lineItemsRemoved += removedTotals.c;

        db.prepare(`DELETE FROM invoice_line_items WHERE invoice_id = ? AND classification_id IN (${placeholders})`)
          .run(invoice_id, ...classIdList);

        const remaining = db.prepare('SELECT COUNT(*) c FROM invoice_line_items WHERE invoice_id = ?').get(invoice_id);
        if (remaining.c === 0) {
          db.prepare('DELETE FROM invoices WHERE id = ?').run(invoice_id);
          report.totalInvoicesFullyRemoved += 1;
          report.byCenter[center.id].invoicesFullyRemoved += 1;
        } else {
          const inv = db.prepare('SELECT taxable_value, gst_value FROM invoices WHERE id = ?').get(invoice_id);
          const newTaxable = inv.taxable_value - removedTotals.taxable;
          const newGst = inv.gst_value - removedTotals.gst;
          db.prepare('UPDATE invoices SET taxable_value = ?, gst_value = ?, total_bill_value = ? WHERE id = ?')
            .run(newTaxable, newGst, newTaxable + newGst, invoice_id);
          report.totalInvoicesTotalsAdjusted += 1;
        }
      }

      db.prepare(`DELETE FROM product_catalog WHERE id IN (${catPlaceholders})`).run(...catalogIds);
      report.totalCatalogRemoved += catalogIds.length;
      report.byCenter[center.id].catalogRemoved = catalogIds.length;
    }

    if (apply) {
      db.exec('COMMIT');
      report.applied = true;
    } else {
      db.exec('ROLLBACK');
    }
  } catch (err) {
    db.exec('ROLLBACK');
    report.fatalError = err.message;
    report.fatalStack = err.stack;
  }

  return report;
}

module.exports = { run, TARGET_CLASSIFICATIONS };

if (require.main === module) {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const [dbPath] = args.filter(a => a !== '--apply');
  if (!dbPath) {
    console.error('Usage: node remove-classifications-all-centers.js <db-path> [--apply]');
    process.exit(1);
  }
  console.log(JSON.stringify(run(dbPath, { apply }), null, 2));
}
