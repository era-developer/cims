// One-time backfill: mirror an existing center's full catalog (name,
// classification, unit, description, image, tag_code) into every other
// center at 0 stock -- same mechanism as the ongoing per-invoice sync in
// invoices.js's getOrCreateCatalog, just applied retroactively to a
// center's current catalog instead of one new item at a time.
// Skips any name that already exists at the target center (their own
// legacy catalog is left untouched).
//
// Usage: node backfill-catalog-to-all-centers.js <db-path> <source-center-id> [--apply]

const { openDatabase } = require('../utils/db');
const { CENTERS, requireCenter } = require('./legacy-centers');

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
      let created = 0;
      let skipped = 0;
      for (const item of sourceItems) {
        const existing = db.prepare('SELECT id FROM product_catalog WHERE center_id = ? AND name = ?').get(center.id, item.name);
        if (existing) { skipped += 1; continue; }
        insert.run(center.id, item.name, item.classification_id, item.unit, item.description, item.image, item.tag_code);
        created += 1;
      }
      report.byCenter[center.id] = { created, skippedAlreadyPresent: skipped };
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
    console.error('Usage: node backfill-catalog-to-all-centers.js <db-path> <source-center-id> [--apply]');
    process.exit(1);
  }
  console.log(JSON.stringify(run(dbPath, sourceCenterId, { apply }), null, 2));
}
