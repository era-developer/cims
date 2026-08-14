// One-time fix: the July 2026 JP Nagar bulk import (import-jp-nagar-july2026.js)
// created invoices without a business_head_id. The user confirmed all of that
// spreadsheet data was procured for ComedK -- assign it explicitly so the
// ComedK/ERA Foundation dashboard split has real numbers on the ComedK side.
//
// Usage: node assign-comedk-to-jp-nagar-invoices.js <db-path> [--apply]

const { openDatabase } = require('../utils/db');

function run(dbPath, { apply = false } = {}) {
  const db = openDatabase(dbPath);
  const comedk = db.prepare("SELECT id FROM business_heads WHERE name = 'ComedK'").get();
  if (!comedk) throw new Error("'ComedK' business head not found");

  const report = { comedkId: comedk.id, before: null, updated: 0, after: null, applied: false, fatalError: null };
  report.before = db.prepare("SELECT business_head_id, COUNT(*) c FROM invoices WHERE center_id = 'jp_nagar' GROUP BY business_head_id").all();

  db.exec('BEGIN TRANSACTION');
  try {
    report.updated = db.prepare(`
      UPDATE invoices SET business_head_id = ? WHERE center_id = 'jp_nagar' AND business_head_id IS NULL
    `).run(comedk.id).changes;
    report.after = db.prepare("SELECT business_head_id, COUNT(*) c FROM invoices WHERE center_id = 'jp_nagar' GROUP BY business_head_id").all();

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
  const [dbPath] = args.filter(a => a !== '--apply');
  if (!dbPath) {
    console.error('Usage: node assign-comedk-to-jp-nagar-invoices.js <db-path> [--apply]');
    process.exit(1);
  }
  console.log(JSON.stringify(run(dbPath, { apply }), null, 2));
}
