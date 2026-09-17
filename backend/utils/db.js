const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'db', 'migrations');

let db = null;

function open(dbFilePath) {
  const database = new DatabaseSync(dbFilePath);
  database.exec('PRAGMA journal_mode = WAL');
  database.exec('PRAGMA foreign_keys = ON');
  return database;
}

function runMigrations(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  const applied = new Set(
    database.prepare('SELECT version FROM schema_migrations').all().map(row => row.version)
  );

  const files = fs.readdirSync(MIGRATIONS_DIR)
    .filter(name => name.endsWith('.sql'))
    .sort();

  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');
    database.exec(sql);
    database.prepare('INSERT INTO schema_migrations (version) VALUES (?)').run(file);
    console.log(`[db] applied migration ${file}`);
  }
}

// Opens (creating if needed) a SQLite database at dbFilePath and applies any
// pending migrations from db/migrations. Pass a distinct path for dry-run
// migrations so the real database (getDb()'s default) is never touched.
function openDatabase(dbFilePath) {
  const database = open(dbFilePath);
  runMigrations(database);
  return database;
}

function getDb() {
  if (!db) {
    // KIMS_DB_PATH is the name a Kalam Pragati deployment uses; CIMS_DB_PATH
    // is kept working so an existing Comedkare .env needs no edit. A relative
    // path resolves against backend/ rather than the process working
    // directory, so the service behaves the same however it was started.
    const configured = process.env.KIMS_DB_PATH || process.env.CIMS_DB_PATH;
    const dbFilePath = configured
      ? path.resolve(__dirname, '..', configured)
      : path.join(__dirname, '..', 'data', 'cims.db');
    db = openDatabase(dbFilePath);
  }
  return db;
}

module.exports = { openDatabase, getDb };
