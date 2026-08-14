// Corrects a handful of catalog items whose classification was clearly
// wrong (found by auditing the full catalog by classification bucket --
// e.g. PPE sitting in "Hand tools" instead of "Safety tools"). Applied by
// name across every center at once, the same way a single Edit Component
// save now propagates, since these are properties of the component itself.
//
// Usage: node fix-classifications.js <db-path> [--apply]

const { openDatabase } = require('../utils/db');

const CORRECTIONS = [
  { name: 'Welding Shield Helmet', toClassification: 'Safety tools' },
  { name: 'Dust Mask', toClassification: 'Safety tools' },
  { name: 'First Aid Box', toClassification: 'Safety tools' },
  { name: 'Jigsaw Blade', toClassification: 'Other hand tools & Spares' },
  { name: 'Metal Cutting Disc', toClassification: 'Other hand tools & Spares' },
  { name: 'Cotton Waste', toClassification: 'Single use Consumables' },
  { name: 'Motor Coupling Hub (Big)', toClassification: 'Other hand tools & Spares' },
  { name: 'Glue Gun', toClassification: 'Power tools' },
];

function run(dbPath, { apply = false } = {}) {
  const db = openDatabase(dbPath);
  const report = { corrections: [], applied: false, fatalError: null };

  db.exec('BEGIN TRANSACTION');
  try {
    for (const fix of CORRECTIONS) {
      const targetClass = db.prepare('SELECT id, name FROM classifications WHERE name = ?').get(fix.toClassification);
      if (!targetClass) throw new Error(`Classification "${fix.toClassification}" not found`);

      const rows = db.prepare(`
        SELECT pc.id, pc.center_id, pc.name, cl.name AS fromClassification
        FROM product_catalog pc JOIN classifications cl ON cl.id = pc.classification_id
        WHERE pc.name = ?
      `).all(fix.name);

      const entry = { name: fix.name, toClassification: fix.toClassification, updatedRows: [] };
      for (const row of rows) {
        db.prepare('UPDATE product_catalog SET classification_id = ? WHERE id = ?').run(targetClass.id, row.id);
        db.prepare('UPDATE assets SET classification_id = ? WHERE catalog_id = ?').run(targetClass.id, row.id);
        entry.updatedRows.push({ centerId: row.center_id, from: row.fromClassification });
      }
      report.corrections.push(entry);
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

module.exports = { run, CORRECTIONS };

if (require.main === module) {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const [dbPath] = args.filter(a => a !== '--apply');
  if (!dbPath) {
    console.error('Usage: node fix-classifications.js <db-path> [--apply]');
    process.exit(1);
  }
  console.log(JSON.stringify(run(dbPath, { apply }), null, 2));
}
