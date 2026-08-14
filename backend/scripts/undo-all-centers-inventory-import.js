// Undoes the "system:all_centers_inventory_import" batch entirely: deletes
// every invoice/line-item/asset/lifecycle-event it created (real stock for
// the 8 non-JP-Nagar centers), then removes any catalog rows -- in ANY
// center, including JP Nagar, since new item types get mirrored everywhere
// at 0 stock -- that only exist because of this import and now have zero
// assets left. JP Nagar's own pre-existing data (created_by
// 'system:jp_nagar_july2026_audit' / 'superadmin') is never touched.
//
// Usage: node undo-all-centers-inventory-import.js <db-path> [--apply]

const { openDatabase } = require('../utils/db');

const IMPORT_MARKER = 'system:all_centers_inventory_import';

function run(dbPath, { apply = false } = {}) {
  const db = openDatabase(dbPath);
  const report = {
    invoicesDeleted: 0, lineItemsDeleted: 0, assetsDeleted: 0, lifecycleEventsDeleted: 0,
    orphanCatalogRowsDeleted: 0, byCenter: {}, applied: false, fatalError: null,
  };

  db.exec('BEGIN TRANSACTION');
  try {
    const invoices = db.prepare('SELECT id, center_id FROM invoices WHERE created_by = ?').all(IMPORT_MARKER);
    for (const invoice of invoices) {
      const lineItems = db.prepare('SELECT id FROM invoice_line_items WHERE invoice_id = ?').all(invoice.id);
      let centerAssetCount = 0;
      for (const li of lineItems) {
        const assets = db.prepare('SELECT id FROM assets WHERE invoice_line_item_id = ?').all(li.id);
        for (const asset of assets) {
          report.lifecycleEventsDeleted += db.prepare('DELETE FROM asset_lifecycle_events WHERE asset_id = ?').run(asset.id).changes;
        }
        centerAssetCount += db.prepare('DELETE FROM assets WHERE invoice_line_item_id = ?').run(li.id).changes;
      }
      report.assetsDeleted += centerAssetCount;
      report.lineItemsDeleted += db.prepare('DELETE FROM invoice_line_items WHERE invoice_id = ?').run(invoice.id).changes;
      db.prepare('DELETE FROM invoices WHERE id = ?').run(invoice.id);
      report.invoicesDeleted += 1;
      report.byCenter[invoice.center_id] = (report.byCenter[invoice.center_id] || 0) + centerAssetCount;
    }

    // Any catalog row (in any center) that now has zero assets AND isn't
    // part of JP Nagar's own catalog is a leftover 0-stock placeholder that
    // only exists because this import introduced that item name somewhere.
    // Must compare against JP Nagar's REAL 606-item set (names that actually
    // have assets there), not its current catalog list -- JP Nagar's own
    // catalog got the same 830 leftover 0-stock placeholders mirrored onto
    // it by this import, so an unfiltered name list would still include them
    // and every other center's matching placeholder would wrongly survive.
    const jpNagarRealNames = new Set(db.prepare(`
      SELECT DISTINCT pc.name FROM product_catalog pc
      JOIN assets a ON a.catalog_id = pc.id
      WHERE pc.center_id = 'jp_nagar'
    `).all().map(r => r.name));
    const allCatalogRows = db.prepare(`
      SELECT pc.id, pc.center_id, pc.name, COUNT(a.id) AS assetCount
      FROM product_catalog pc LEFT JOIN assets a ON a.catalog_id = pc.id
      WHERE pc.center_id != 'jp_nagar'
      GROUP BY pc.id
    `).all();
    for (const row of allCatalogRows) {
      if (row.assetCount === 0 && !jpNagarRealNames.has(row.name)) {
        db.prepare('DELETE FROM product_catalog WHERE id = ?').run(row.id);
        report.orphanCatalogRowsDeleted += 1;
      }
    }
    // Same cleanup on JP Nagar's own catalog: every one of its real 606
    // original items was created from a real invoice with real quantity, so
    // it always has at least one asset row. A JP Nagar catalog row with
    // zero total asset rows (not just zero available stock) only exists
    // because another center's import introduced that item name and it got
    // mirrored back as a 0-stock placeholder -- safe to remove.
    const jpNagarOrphans = db.prepare(`
      SELECT pc.id FROM product_catalog pc
      LEFT JOIN assets a ON a.catalog_id = pc.id
      WHERE pc.center_id = 'jp_nagar'
      GROUP BY pc.id
      HAVING COUNT(a.id) = 0
    `).all();
    for (const row of jpNagarOrphans) {
      db.prepare('DELETE FROM product_catalog WHERE id = ?').run(row.id);
      report.orphanCatalogRowsDeleted += 1;
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

module.exports = { run, IMPORT_MARKER };

if (require.main === module) {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const [dbPath] = args.filter(a => a !== '--apply');
  if (!dbPath) {
    console.error('Usage: node undo-all-centers-inventory-import.js <db-path> [--apply]');
    process.exit(1);
  }
  console.log(JSON.stringify(run(dbPath, { apply }), null, 2));
}
