// Builds a fresh KIMS (Kalam Pragati) database from scratch.
//
// This is deliberately NOT reset-users-fresh-start.js: that script wipes an
// existing database in place, which is exactly the wrong tool when the goal is
// a brand new deployment that must never touch the Comedkare data. This one
// refuses to run against a database that already has users, and never opens
// the Comedkare database for anything but reading the component master.
//
// What it produces:
//   - one center: AKTU, Lucknow
//   - one super_admin: kalampragati@erafoundationindia.org / 9686737460
//   - the full component catalogue, names preserved, every item at stock 0
//   - org settings (name, tagline, notification email + WhatsApp number)
//
// Stock 0 is the natural state, not something that needs zeroing: stock is
// derived as COUNT(assets WHERE status='available'), so seeding the catalog
// without seeding any `assets` rows leaves every item at 0.
//
// Usage:
//   node seed-kims.js --db ../data/kims.db [--catalog-from D:/cims/backend/data/cims.db] [--apply]
//   node seed-kims.js --db ../data/kims.db --no-catalog --apply
//
// Without --apply it prints what it would do and writes nothing.

const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const { DatabaseSync } = require('node:sqlite');
const { openDatabase } = require('../utils/db');

// ---------- What we are seeding ----------

const CENTER = {
  id: 'aktu_lucknow',
  code: 'AKTU',
  name: 'AKTU, Lucknow',
};

const SUPER_ADMIN = {
  username: 'superadmin',
  fullName: 'Kalam Pragati Super Admin',
  email: 'kalampragati@erafoundationindia.org',
  mobile: '9686737460',
  role: 'super_admin',
};

const ORG_SETTINGS = {
  'org.name': 'Kalam Pragati',
  'org.short_name': 'KIMS',
  'org.tagline': 'Empowering Engineers with Skills for Success',
  'notify.email_sender_name': 'Kalam Pragati - KIMS',
  'notify.order_email': SUPER_ADMIN.email,
  'notify.whatsapp_admin': `+91${SUPER_ADMIN.mobile}`,
};

// ---------- Args ----------

function parseArgs(argv) {
  const args = {
    db: path.join(__dirname, '..', 'data', 'kims.db'),
    // The Comedkare copy that used to live in this tree was removed (it held
    // student PII). Opened read-only, so pointing at the live deployment's
    // database is safe.
    catalogFrom: 'D:/cims/backend/data/cims.db',
    noCatalog: false,
    apply: false,
    password: process.env.KIMS_SEED_PASSWORD || '',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--db') args.db = argv[++i];
    else if (arg === '--catalog-from') args.catalogFrom = argv[++i];
    else if (arg === '--no-catalog') args.noCatalog = true;
    else if (arg === '--apply') args.apply = true;
    else if (arg === '--password') args.password = argv[++i];
  }
  return args;
}

// A seeded password that is printed to the console is a password that ends up
// in a terminal scrollback and a screenshot. Generated unless one is passed
// explicitly, and always shown exactly once so it can be changed on first
// login.
function generatePassword() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = crypto.randomBytes(16);
  return `Kp${Array.from(bytes).map(b => alphabet[b % alphabet.length]).join('').slice(0, 14)}!`;
}

// ---------- Catalog master ----------

// Reads the distinct component master out of an existing CIMS database.
//
// The nine Comedkare centers each drifted to a slightly different catalog
// (615-787 items), so the union of names across all of them -- not any single
// center's list -- is the complete component master. Classification, category
// and unit are resolved per name by majority vote across the centers that
// carry it, so a name that one center happened to misfile does not decide how
// the new center classifies it.
function readCatalogMaster(sourceDbPath) {
  if (!fs.existsSync(sourceDbPath)) {
    throw new Error(`Catalog source database not found: ${sourceDbPath}`);
  }

  // Read-only: this may point at a live CIMS database and must never write.
  const source = new DatabaseSync(sourceDbPath, { readOnly: true });
  try {
    const classifications = source.prepare(
      'SELECT id, name, sort_order FROM classifications ORDER BY sort_order, id'
    ).all();

    const rows = source.prepare(`
      SELECT name,
             classification_id,
             category,
             unit,
             COUNT(*) AS votes
      FROM product_catalog
      WHERE TRIM(COALESCE(name, '')) <> ''
      GROUP BY name, classification_id, category, unit
      ORDER BY name COLLATE NOCASE, votes DESC
    `).all();

    const byName = new Map();
    for (const row of rows) {
      // Rows arrive sorted by votes DESC within each name, so the first one
      // seen is the majority spelling of that item's classification/unit.
      if (byName.has(row.name)) continue;
      byName.set(row.name, {
        name: row.name,
        classificationId: row.classification_id,
        category: row.category,
        unit: row.unit || 'pcs',
      });
    }

    return { classifications, items: [...byName.values()] };
  } finally {
    source.close();
  }
}

// ---------- Seed ----------

async function run(args) {
  const report = {
    dbPath: args.db,
    applied: false,
    center: null,
    superAdmin: null,
    classifications: 0,
    catalogItems: 0,
    password: null,
  };

  const master = args.noCatalog
    ? { classifications: [], items: [] }
    : readCatalogMaster(args.catalogFrom);

  report.classifications = master.classifications.length;
  report.catalogItems = master.items.length;
  report.center = CENTER;
  report.superAdmin = { ...SUPER_ADMIN };

  if (!args.apply) {
    return report;
  }

  fs.mkdirSync(path.dirname(args.db), { recursive: true });

  // openDatabase() creates the file if absent and applies every migration in
  // db/migrations, so a fresh KIMS database gets the full v2 schema including
  // the new app_settings table.
  const db = openDatabase(args.db);

  // Refuse to seed over an existing deployment. Without this, a second run
  // after go-live would hit the UNIQUE constraints and roll back, but only
  // after someone had already pointed the script at a live database.
  const existingUsers = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  const existingCenters = db.prepare('SELECT COUNT(*) AS n FROM centers').get().n;
  if (existingUsers > 0 || existingCenters > 0) {
    throw new Error(
      `Refusing to seed: ${args.db} already has ${existingCenters} center(s) and ${existingUsers} user(s). ` +
      'Seed into a new database file, or delete this one deliberately first.'
    );
  }

  const password = args.password || generatePassword();
  const passwordHash = await bcrypt.hash(password, 10);
  const now = new Date().toISOString();

  db.exec('BEGIN TRANSACTION');
  try {
    db.prepare(`
      INSERT INTO centers (id, code, name, active, notification_email, whatsapp_number, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, ?, datetime('now'), datetime('now'))
    `).run(CENTER.id, CENTER.code, CENTER.name, SUPER_ADMIN.email, `+91${SUPER_ADMIN.mobile}`);

    // center_id stays NULL: a super admin is org-scoped, not tied to a center.
    db.prepare(`
      INSERT INTO users (id, center_id, username, password_hash, full_name, email, mobile,
        alt_mobile, college, graduation_year, degree, department, role, active, created_at, source)
      VALUES (?, NULL, ?, ?, ?, ?, ?, '', '', '', '', '', ?, 1, ?, 'manual')
    `).run(
      crypto.randomUUID(),
      SUPER_ADMIN.username,
      passwordHash,
      SUPER_ADMIN.fullName,
      SUPER_ADMIN.email,
      SUPER_ADMIN.mobile,
      SUPER_ADMIN.role,
      now
    );

    // Classification ids are carried over verbatim so catalog rows keep their
    // classification_id foreign key without a remapping table.
    const insertClassification = db.prepare(
      'INSERT OR IGNORE INTO classifications (id, name, sort_order) VALUES (?, ?, ?)'
    );
    for (const c of master.classifications) {
      insertClassification.run(c.id, c.name, c.sort_order);
    }

    const insertCatalog = db.prepare(`
      INSERT INTO product_catalog (center_id, name, classification_id, category, unit)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const item of master.items) {
      insertCatalog.run(CENTER.id, item.name, item.classificationId, item.category, item.unit);
    }

    const insertSetting = db.prepare(`
      INSERT INTO app_settings (key, value, updated_at, updated_by)
      VALUES (?, ?, datetime('now'), 'seed-kims')
    `);
    for (const [key, value] of Object.entries(ORG_SETTINGS)) {
      insertSetting.run(key, value);
    }

    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    db.close();
    throw error;
  }

  // Deliberately no `assets` rows: stock is COUNT(available assets), so every
  // catalog item reads as 0 in stock, which is the requested starting state.
  const stockCheck = db.prepare('SELECT COUNT(*) AS n FROM assets').get().n;
  const catalogCount = db.prepare('SELECT COUNT(*) AS n FROM product_catalog WHERE center_id = ?').get(CENTER.id).n;
  db.close();

  report.applied = true;
  report.password = password;
  report.catalogItems = catalogCount;
  report.assets = stockCheck;
  return report;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  try {
    const report = await run(args);

    console.log('');
    console.log(report.applied ? '=== KIMS seed APPLIED ===' : '=== KIMS seed DRY RUN (no changes written) ===');
    console.log(`Database      : ${report.dbPath}`);
    console.log(`Center        : ${report.center.name} (${report.center.code} / ${report.center.id})`);
    console.log(`Classifications: ${report.classifications}`);
    console.log(`Catalog items : ${report.catalogItems}  (all at stock 0 -- no asset units seeded)`);
    console.log('');
    console.log('Super admin');
    console.log(`  username : ${report.superAdmin.username}`);
    console.log(`  email    : ${report.superAdmin.email}`);
    console.log(`  mobile   : ${report.superAdmin.mobile}`);
    if (report.applied) {
      console.log(`  password : ${report.password}`);
      console.log('');
      console.log('  ^ Shown once. Sign in and change it, then this line can be cleared');
      console.log('    from your terminal scrollback.');
    } else {
      console.log('  password : (generated on --apply)');
      console.log('');
      console.log('Re-run with --apply to write.');
    }
    console.log('');
  } catch (error) {
    console.error(`\nSeed failed: ${error.message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = { run, readCatalogMaster, CENTER, SUPER_ADMIN, ORG_SETTINGS };
