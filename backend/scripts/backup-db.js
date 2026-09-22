// Nightly database backup. Run by the Windows scheduled task "CIMS Backup"
// (see install-cims-backup-task.ps1); safe to run by hand any time.
//
// Uses SQLite's VACUUM INTO, which produces a consistent, compacted copy even
// while the service is running and writing. Keeps the last 30 daily copies
// plus the first backup of each month for a year, so a mistake noticed weeks
// later can still be undone.
//
// Files land in data/backups/cims-YYYY-MM-DD.db. Copy that folder somewhere
// off this PC (Drive, another machine) if you want protection against the
// disk itself failing -- a backup on the same disk is not that.
//
// Usage: node backup-db.js [--db ../data/cims.db] [--keep-days 30]

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const { BACKUPS_DIR, DATA_ROOT } = require('../utils/storage');

function parseArgs(argv) {
  const args = { db: path.join(DATA_ROOT, 'cims.db'), keepDays: 30 };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--db') args.db = argv[++i];
    else if (argv[i] === '--keep-days') args.keepDays = Number(argv[++i]) || 30;
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const today = new Date().toISOString().slice(0, 10);
  const target = path.join(BACKUPS_DIR, `cims-${today}.db`);

  const db = new DatabaseSync(args.db, { readOnly: true });
  try {
    if (fs.existsSync(target)) fs.rmSync(target);
    db.exec(`VACUUM INTO '${target.replace(/'/g, "''")}'`);
  } finally {
    db.close();
  }
  const size = fs.statSync(target).size;
  console.log(`${new Date().toISOString()} backup written: ${target} (${(size / 1024).toFixed(0)} KB)`);

  // Prune: keep everything from the last keepDays, and the earliest backup of
  // each month for the last 12 months. Manual snapshots (cims-before-*.db)
  // are never pruned automatically.
  const cutoff = Date.now() - args.keepDays * 86400000;
  const yearAgo = Date.now() - 365 * 86400000;
  const dailies = fs.readdirSync(BACKUPS_DIR)
    .filter(f => /^cims-\d{4}-\d{2}-\d{2}\.db$/.test(f))
    .sort();
  const keptMonths = new Set();
  let pruned = 0;
  for (const f of dailies) {
    const date = new Date(f.slice(5, 15)).getTime();
    const month = f.slice(5, 12);
    if (date >= cutoff) continue;
    if (date >= yearAgo && !keptMonths.has(month)) { keptMonths.add(month); continue; }
    fs.rmSync(path.join(BACKUPS_DIR, f));
    pruned += 1;
  }
  if (pruned) console.log(`pruned ${pruned} old backup(s)`);
}

try { main(); } catch (error) { console.error(`backup failed: ${error.message}`); process.exitCode = 1; }
