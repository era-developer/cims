// Removes the "Interior infrastructure" (civil/interior-fitout work)
// records added to JP Nagar for insurance-value reconciliation -- decided
// not worth keeping in the lending-inventory portal after seeing the
// result. Deletes their assets/lifecycle events/invoice line items, then
// any invoice left with zero line items as a result.
//
// Usage: node remove-interior-furnishing.js <db-path> <center-id> [--apply]

const { openDatabase } = require('../utils/db');
const { requireCenter } = require('../utils/centers');

function run(dbPath, centerId, { apply = false } = {}) {
  const db = openDatabase(dbPath);
  const center = requireCenter(centerId);
  const report = { catalogRemoved: 0, assetsRemoved: 0, lineItemsRemoved: 0, invoicesRemoved: 0, fatalError: null, applied: false };

  db.exec('BEGIN TRANSACTION');
  try {
    const catalogIds = db.prepare(`
      SELECT id FROM product_catalog
      WHERE center_id = ? AND classification_id = (SELECT id FROM classifications WHERE name = 'Interior infrastructure')
    `).all(center.id).map(r => r.id);

    if (catalogIds.length) {
      const placeholders = catalogIds.map(() => '?').join(',');

      report.assetsRemoved = db.prepare(`
        DELETE FROM asset_lifecycle_events WHERE asset_id IN (
          SELECT id FROM assets WHERE catalog_id IN (${placeholders})
        )
      `).run(...catalogIds).changes;
      db.prepare(`DELETE FROM assets WHERE catalog_id IN (${placeholders})`).run(...catalogIds);

      const lineItemInvoiceIds = db.prepare(`
        SELECT DISTINCT invoice_id FROM invoice_line_items
        WHERE classification_id = (SELECT id FROM classifications WHERE name = 'Interior infrastructure')
          AND invoice_id IN (SELECT id FROM invoices WHERE center_id = ?)
      `).all(center.id).map(r => r.invoice_id);

      report.lineItemsRemoved = db.prepare(`
        DELETE FROM invoice_line_items
        WHERE classification_id = (SELECT id FROM classifications WHERE name = 'Interior infrastructure')
          AND invoice_id IN (SELECT id FROM invoices WHERE center_id = ?)
      `).run(center.id).changes;

      db.prepare(`DELETE FROM product_catalog WHERE id IN (${placeholders})`).run(...catalogIds);
      report.catalogRemoved = catalogIds.length;

      for (const invoiceId of lineItemInvoiceIds) {
        const remaining = db.prepare('SELECT COUNT(*) c FROM invoice_line_items WHERE invoice_id = ?').get(invoiceId);
        if (remaining.c === 0) {
          db.prepare('DELETE FROM invoices WHERE id = ?').run(invoiceId);
          report.invoicesRemoved += 1;
        }
      }
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
  }

  return report;
}

module.exports = { run };

if (require.main === module) {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const [dbPath, centerId] = args.filter(a => a !== '--apply');
  if (!dbPath || !centerId) {
    console.error('Usage: node remove-interior-furnishing.js <db-path> <center-id> [--apply]');
    process.exit(1);
  }
  console.log(JSON.stringify(run(dbPath, centerId, { apply }), null, 2));
}
