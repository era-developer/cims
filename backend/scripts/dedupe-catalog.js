// Merges duplicate catalog entries that differ only in spacing, case or
// punctuation ("DHT 11" / "DHT11", "IC  LM 317" / "IC  LM317", "Blue - LED" /
// "Blue LED"), keeping one row per component per center.
//
// Which row survives, in order of preference:
//   1. has a photo
//   2. has a description
//   3. has other detail (tag code, warranty, reference videos)
//   4. is already referenced by assets / orders
//   5. lowest id
// The survivor then absorbs any field it lacks from the rows being removed
// (a duplicate's description is not thrown away just because it lost the
// photo tie-break), and every table pointing at a removed row is re-pointed
// at the survivor, so no asset, order line, transfer or BOM is orphaned.
//
// Decimal points are significant when grouping: "Resistor 4.7K" and
// "Resistor 47K" are different parts and are never merged.
//
// Usage:
//   node dedupe-catalog.js [--db ../data/kims.db] [--apply]
// Dry run prints the plan; --apply takes a snapshot of the database first.

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

function parseArgs(argv) {
  const args = { db: path.join(__dirname, '..', 'data', 'kims.db'), apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--db') args.db = argv[++i];
    else if (argv[i] === '--apply') args.apply = true;
  }
  return args;
}

// "IC  LM 317" -> "iclm317"; "Resistor - 4.7K Ohm" -> "resistor4point7kohm".
function normalizeName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/(\d)\.(\d)/g, '$1point$2')
    .replace(/[^a-z0-9]+/g, '');
}

// The survivor's display name: its own name with runs of whitespace
// collapsed and stray " - " separators tidied, e.g. "IC  LM 317" -> "IC LM 317".
function tidyName(name) {
  return String(name || '').replace(/\s+/g, ' ').replace(/\s+-\s+/g, ' ').trim();
}

const DETAIL_FIELDS = ['image', 'description', 'tag_code', 'has_warranty', 'warranty_until', 'reference_videos', 'category', 'unit', 'reorder_point'];

function hasValue(v) {
  return v !== null && v !== undefined && String(v).trim() !== '' && v !== 0;
}

function referencingTables(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name != 'product_catalog'").all().map(r => r.name);
  return tables
    .map(t => ({ table: t, cols: db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name) }))
    .filter(t => t.cols.includes('catalog_id'))
    .map(t => ({ table: t.table, hasName: t.cols.includes('name') }));
}

function refCount(db, refs, catalogId) {
  let n = 0;
  for (const { table } of refs) {
    n += db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE catalog_id = ?`).get(catalogId).n;
  }
  return n;
}

function score(row, refs) {
  return (hasValue(row.image) ? 1000 : 0)
    + (hasValue(row.description) ? 100 : 0)
    + (hasValue(row.tag_code) ? 10 : 0)
    + (hasValue(row.has_warranty) ? 10 : 0)
    + (hasValue(row.reference_videos) ? 10 : 0)
    + Math.min(refs, 9);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const db = new DatabaseSync(args.db);
  db.exec('PRAGMA foreign_keys = ON');

  const refs = referencingTables(db);
  const rows = db.prepare('SELECT * FROM product_catalog').all();

  const groups = new Map();
  for (const row of rows) {
    const key = `${row.center_id}::${normalizeName(row.name)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const dupGroups = [...groups.values()].filter(g => g.length > 1);

  const plan = dupGroups.map(group => {
    const ranked = group
      .map(row => ({ row, refs: refCount(db, refs, row.id) }))
      .map(x => ({ ...x, score: score(x.row, x.refs) }))
      .sort((a, b) => b.score - a.score || a.row.id - b.row.id);
    const keeper = ranked[0].row;
    const losers = ranked.slice(1).map(x => x.row);

    const merged = {};
    for (const field of DETAIL_FIELDS) {
      if (hasValue(keeper[field])) continue;
      const donor = losers.find(l => hasValue(l[field]));
      if (donor) merged[field] = donor[field];
    }
    return { keeper, losers, merged, newName: tidyName(keeper.name), refsMoved: ranked.slice(1).reduce((s, x) => s + x.refs, 0) };
  });

  console.log(`Catalog rows: ${rows.length}`);
  console.log(`Duplicate groups: ${plan.length}  (rows to remove: ${plan.reduce((s, p) => s + p.losers.length, 0)})`);
  console.log('');
  for (const p of plan) {
    const absorbed = Object.keys(p.merged);
    console.log(`KEEP  #${p.keeper.id} "${p.newName}"${p.newName !== p.keeper.name ? `  (was "${p.keeper.name}")` : ''}`);
    for (const l of p.losers) console.log(`  drop #${l.id} "${l.name}"`);
    if (absorbed.length) console.log(`  absorbs: ${absorbed.join(', ')}`);
    if (p.refsMoved) console.log(`  re-points ${p.refsMoved} referencing row(s)`);
  }

  if (!args.apply) {
    console.log('\nDry run. Re-run with --apply to merge.');
    db.close();
    return;
  }

  // Consistent snapshot even while the service has the file open.
  const backup = path.join(require('../utils/storage').BACKUPS_DIR, `kims-before-dedupe-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
  console.log(`\nSnapshot: ${backup}`);

  const setFields = DETAIL_FIELDS.map(f => `${f} = ?`).join(', ');
  const updateKeeper = db.prepare(`UPDATE product_catalog SET name = ?, ${setFields} WHERE id = ?`);
  const deleteRow = db.prepare('DELETE FROM product_catalog WHERE id = ?');

  db.exec('BEGIN');
  try {
    for (const p of plan) {
      const values = DETAIL_FIELDS.map(f => (p.merged[f] !== undefined ? p.merged[f] : p.keeper[f]));
      // Free the tidied name first if a loser holds it (UNIQUE(center_id, name)).
      for (const l of p.losers) {
        for (const { table, hasName } of refs) {
          db.prepare(`UPDATE ${table} SET catalog_id = ?${hasName ? ', name = ?' : ''} WHERE catalog_id = ?`)
            .run(...(hasName ? [p.keeper.id, p.newName, l.id] : [p.keeper.id, l.id]));
        }
        deleteRow.run(l.id);
      }
      updateKeeper.run(p.newName, ...values, p.keeper.id);
      for (const { table, hasName } of refs) {
        if (hasName) db.prepare(`UPDATE ${table} SET name = ? WHERE catalog_id = ?`).run(p.newName, p.keeper.id);
      }
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    db.close();
    throw error;
  }

  const after = db.prepare('SELECT COUNT(*) AS n FROM product_catalog').get().n;
  const orphans = refs.reduce((s, { table }) => s + db.prepare(
    `SELECT COUNT(*) AS n FROM ${table} WHERE catalog_id IS NOT NULL AND catalog_id NOT IN (SELECT id FROM product_catalog)`
  ).get().n, 0);
  db.close();
  console.log(`Done. Catalog rows now: ${after}. Orphaned references: ${orphans}.`);
}

try {
  main();
} catch (error) {
  console.error(`\nFailed: ${error.message}\n`);
  process.exitCode = 1;
}
