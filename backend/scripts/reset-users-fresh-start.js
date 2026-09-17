// Fresh start: wipes all user/student/order data and creates exactly one
// super_admin plus one admin + one student per center as testing
// credentials. Run after auth.js/admin.js have been switched to the SQLite
// users table (utils/usersDb.js) -- the old users.xlsx files are no longer
// read by anything after this.
//
// Usage: node reset-users-fresh-start.js <db-path> [--apply]

const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { openDatabase } = require('../utils/db');
const { CENTERS } = require('./legacy-centers');

const TEST_PASSWORD = 'Cims@2026';

async function run(dbPath, { apply = false } = {}) {
  const db = openDatabase(dbPath);
  const report = { deleted: {}, created: [], fatalError: null, applied: false };

  db.exec('BEGIN TRANSACTION');
  try {
    report.deleted.orderReturnItems = db.prepare('DELETE FROM order_return_items').run().changes;
    report.deleted.issueRecordAssets = db.prepare('DELETE FROM issue_record_assets').run().changes;
    report.deleted.issueRecordItems = db.prepare('DELETE FROM issue_record_items').run().changes;
    report.deleted.issueRecords = db.prepare('DELETE FROM issue_records').run().changes;
    report.deleted.students = db.prepare('DELETE FROM students').run().changes;
    report.deleted.users = db.prepare('DELETE FROM users').run().changes;

    const insertUser = db.prepare(`
      INSERT INTO users (id, center_id, username, password_hash, full_name, email, mobile, alt_mobile,
        college, graduation_year, degree, department, role, active, created_at, source)
      VALUES (?, ?, ?, ?, ?, ?, ?, '', '', '', '', '', ?, 1, ?, 'manual')
    `);
    const passwordHash = await bcrypt.hash(TEST_PASSWORD, 10);
    const now = new Date().toISOString();

    function addUser({ username, fullName, email, mobile, role, centerId }) {
      const id = crypto.randomUUID();
      insertUser.run(id, centerId || null, username, passwordHash, fullName, email, mobile || '9999999999', role, now);
      report.created.push({ username, role, centerId: centerId || '(all centers)', email, password: TEST_PASSWORD });
    }

    addUser({ username: 'superadmin', fullName: 'Super Admin', email: 'gurubadiger367@gmail.com', role: 'super_admin', centerId: null });

    for (const center of CENTERS) {
      addUser({
        username: `${center.id}_admin`, fullName: `${center.name} Admin`,
        email: `${center.id}.admin@cims.test`, role: 'admin', centerId: center.id,
      });
      addUser({
        username: `${center.id}_student`, fullName: `${center.name} Test Student`,
        email: center.id === 'jp_nagar' ? 'gurubadiger367@gmail.com' : `${center.id}.student@cims.test`,
        role: 'student', centerId: center.id,
      });
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

module.exports = { run, TEST_PASSWORD };

if (require.main === module) {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const [dbPath] = args.filter(a => a !== '--apply');
  if (!dbPath) {
    console.error('Usage: node reset-users-fresh-start.js <db-path> [--apply]');
    process.exit(1);
  }
  run(dbPath, { apply }).then(report => console.log(JSON.stringify(report, null, 2)));
}
