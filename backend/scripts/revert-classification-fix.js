// Reverts the 8-item classification correction (fix-classifications.js) by
// reading each item's ORIGINAL classification_id straight from the backup
// taken immediately before that fix was applied, rather than trusting a
// hardcoded "from" value -- so this is exact regardless of what else may
// have changed since. Reverts every center's matching row, same as the fix
// did. The cross-center sync mechanism (Edit Component/invoice-entry
// propagation) is a separate, unrelated change and is NOT touched by this.
//
// Usage: node revert-classification-fix.js <db-path> <backup-db-path> [--apply]

const { openDatabase } = require('../utils/db');
const Database = require('node:sqlite').DatabaseSync;

const ITEM_NAMES = [
  'Welding Shield Helmet',
  'Dust Mask',
  'First Aid Box',
  'Jigsaw Blade',
  'Metal Cutting Disc',
  'Cotton Waste',
  'Motor Coupling Hub (Big)',
  'Glue Gun',
];

function run(dbPath, backupPath, { apply = false } = {}) {
  const db = openDatabase(dbPath);
  const backup = new Database(backupPath, { readOnly: true });
  const report = { reverted: [], applied: false, fatalError: null };

  db.exec('BEGIN TRANSACTION');
  try {
    for (const name of ITEM_NAMES) {
      const originalRows = backup.prepare(`
        SELECT pc.center_id, pc.classification_id, cl.name AS classificationName
        FROM product_catalog pc JOIN classifications cl ON cl.id = pc.classification_id
        WHERE pc.name = ?
      `).all(name);

      const entry = { name, restoredTo: originalRows[0]?.classificationName, updatedRows: [] };
      for (const orig of originalRows) {
        const current = db.prepare('SELECT id FROM product_catalog WHERE center_id = ? AND name = ?').get(orig.center_id, name);
        if (!current) continue;
        db.prepare('UPDATE product_catalog SET classification_id = ? WHERE id = ?').run(orig.classification_id, current.id);
        db.prepare('UPDATE assets SET classification_id = ? WHERE catalog_id = ?').run(orig.classification_id, current.id);
        entry.updatedRows.push(orig.center_id);
      }
      report.reverted.push(entry);
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

  backup.close();
  return report;
}

module.exports = { run, ITEM_NAMES };

if (require.main === module) {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const [dbPath, backupPath] = args.filter(a => a !== '--apply');
  if (!dbPath || !backupPath) {
    console.error('Usage: node revert-classification-fix.js <db-path> <backup-db-path> [--apply]');
    process.exit(1);
  }
  console.log(JSON.stringify(run(dbPath, backupPath, { apply }), null, 2));
}
