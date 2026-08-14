// For every center except the source (JP Nagar): wipes their entire
// inventory (assets, lifecycle events, invoices, catalog -- their original
// legacy data, real stock and all) and replaces it with JP Nagar's catalog
// structure at zero stock, so every center starts from the same clean
// component list until its own real spreadsheet is ready.
//
// Usage: node reset-other-centers-to-jp-nagar-structure.js <db-path> <source-center-id> [--apply]

const { openDatabase } = require('../utils/db');
const { CENTERS, requireCenter } = require('../utils/centers');

function wipeCenterInventory(db, centerId) {
  const counts = {};
  counts.lifecycleEvents = db.prepare(`
    DELETE FROM asset_lifecycle_events WHERE asset_id IN (SELECT id FROM assets WHERE center_id = ?)
  `).run(centerId).changes;
  counts.assets = db.prepare('DELETE FROM assets WHERE center_id = ?').run(centerId).changes;
  counts.lineItems = db.prepare(`
    DELETE FROM invoice_line_items WHERE invoice_id IN (SELECT id FROM invoices WHERE center_id = ?)
  `).run(centerId).changes;
  counts.invoices = db.prepare('DELETE FROM invoices WHERE center_id = ?').run(centerId).changes;
  // Dormant Phase-0-migration rows (issue_records etc, not used by the live
  // app) can still reference this center's catalog and block its deletion.
  counts.orderReturnItems = db.prepare(`
    DELETE FROM order_return_items WHERE issue_record_item_id IN (
      SELECT iri.id FROM issue_record_items iri
      JOIN issue_records ir ON ir.id = iri.issue_record_id WHERE ir.center_id = ?
    )
  `).run(centerId).changes;
  counts.issueRecordAssets = db.prepare(`
    DELETE FROM issue_record_assets WHERE issue_record_item_id IN (
      SELECT iri.id FROM issue_record_items iri
      JOIN issue_records ir ON ir.id = iri.issue_record_id WHERE ir.center_id = ?
    )
  `).run(centerId).changes;
  counts.issueRecordItems = db.prepare(`
    DELETE FROM issue_record_items WHERE issue_record_id IN (SELECT id FROM issue_records WHERE center_id = ?)
  `).run(centerId).changes;
  counts.issueRecords = db.prepare('DELETE FROM issue_records WHERE center_id = ?').run(centerId).changes;
  counts.catalog = db.prepare('DELETE FROM product_catalog WHERE center_id = ?').run(centerId).changes;
  return counts;
}

function run(dbPath, sourceCenterId, { apply = false } = {}) {
  const db = openDatabase(dbPath);
  const source = requireCenter(sourceCenterId);

  const sourceItems = db.prepare(`
    SELECT name, classification_id, unit, description, image, tag_code
    FROM product_catalog WHERE center_id = ?
  `).all(source.id);

  const report = { sourceCenter: source.id, sourceItemCount: sourceItems.length, byCenter: {}, applied: false, fatalError: null };

  db.exec('BEGIN TRANSACTION');
  try {
    const insert = db.prepare(`
      INSERT INTO product_catalog (center_id, name, classification_id, unit, description, image, tag_code)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    for (const center of CENTERS) {
      if (center.id === source.id) continue;
      const wiped = wipeCenterInventory(db, center.id);
      for (const item of sourceItems) {
        insert.run(center.id, item.name, item.classification_id, item.unit, item.description, item.image, item.tag_code);
      }
      report.byCenter[center.id] = { wiped, catalogCreated: sourceItems.length };
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
  const [dbPath, sourceCenterId] = args.filter(a => a !== '--apply');
  if (!dbPath || !sourceCenterId) {
    console.error('Usage: node reset-other-centers-to-jp-nagar-structure.js <db-path> <source-center-id> [--apply]');
    process.exit(1);
  }
  console.log(JSON.stringify(run(dbPath, sourceCenterId, { apply }), null, 2));
}
