// Applies a hand-reviewed merge plan to the catalog.
//
// dedupe-catalog.js only merges names that are identical once spacing, case
// and punctuation are ignored, because that is the only kind of duplicate a
// script can decide on its own. Names that are the same part written
// differently ("HC-05 Bluetooth Module" / "Bluetooth Module-HC 05",
// "Jumper Wires M-M" / "Male to Male Jumper Wires (20cm) 40pcs") need a
// person to say so -- and to say what the one clean name should be. That
// decision lives in a JSON plan:
//
//   [ { "name": "Bluetooth Module HC-05", "ids": [183, 184, 411] }, ... ]
//
// For each entry the rows are merged into one: the survivor is the row with
// a photo, then description, then other detail, then existing references;
// it absorbs any field it lacks from the others; every table pointing at a
// removed row is re-pointed; and the survivor takes the plan's name. An entry
// with a single id is just a rename.
//
// Usage:
//   node merge-catalog.js --plan merge-plan.json [--db ../data/cims.db] [--apply]

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

function parseArgs(argv) {
  const args = { db: path.join(__dirname, '..', 'data', 'cims.db'), plan: '', apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--db') args.db = argv[++i];
    else if (argv[i] === '--plan') args.plan = argv[++i];
    else if (argv[i] === '--apply') args.apply = true;
  }
  if (!args.plan) throw new Error('--plan <file.json> is required');
  return args;
}

const DETAIL_FIELDS = ['image', 'description', 'tag_code', 'has_warranty', 'warranty_until', 'reference_videos', 'category', 'unit', 'reorder_point'];
const hasValue = v => v !== null && v !== undefined && String(v).trim() !== '' && v !== 0;

function referencingTables(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name != 'product_catalog'").all()
    .map(r => r.name)
    .map(t => ({ table: t, cols: db.prepare(`PRAGMA table_info(${t})`).all().map(c => c.name) }))
    .filter(t => t.cols.includes('catalog_id'))
    .map(t => ({ table: t.table, hasName: t.cols.includes('name') }));
}

function refCount(db, refs, id) {
  return refs.reduce((n, { table }) => n + db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE catalog_id = ?`).get(id).n, 0);
}

function score(row, refs) {
  return (hasValue(row.image) ? 1000 : 0) + (hasValue(row.description) ? 100 : 0)
    + (hasValue(row.tag_code) ? 10 : 0) + (hasValue(row.has_warranty) ? 10 : 0) + (hasValue(row.reference_videos) ? 10 : 0)
    + Math.min(refs, 9);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const plan = JSON.parse(fs.readFileSync(args.plan, 'utf8'));
  const db = new DatabaseSync(args.db);
  db.exec('PRAGMA foreign_keys = ON');
  const refs = referencingTables(db);
  const getRow = db.prepare('SELECT * FROM product_catalog WHERE id = ?');

  // ---- validate the plan before touching anything ----
  const seenIds = new Set();
  const seenNames = new Set();
  const problems = [];
  const resolved = [];
  for (const entry of plan) {
    const name = String(entry.name || '').replace(/\s+/g, ' ').trim();
    if (!name) problems.push(`entry with ids ${entry.ids} has no name`);
    if (seenNames.has(name.toLowerCase())) problems.push(`name "${name}" appears twice in the plan`);
    seenNames.add(name.toLowerCase());
    const rows = [];
    for (const id of entry.ids || []) {
      if (seenIds.has(id)) problems.push(`id ${id} appears in more than one entry`);
      seenIds.add(id);
      const row = getRow.get(id);
      if (!row) problems.push(`id ${id} (for "${name}") does not exist`);
      else rows.push(row);
    }
    if (!rows.length) continue;
    const centers = new Set(rows.map(r => r.center_id));
    if (centers.size > 1) problems.push(`"${name}" mixes centers ${[...centers].join(', ')}`);
    // The target name must not already belong to a row outside this entry.
    const clash = db.prepare('SELECT id FROM product_catalog WHERE center_id = ? AND LOWER(name) = LOWER(?)').get(rows[0].center_id, name);
    if (clash && !rows.some(r => r.id === clash.id)) problems.push(`"${name}" is already used by row #${clash.id}, which is not in this entry`);
    resolved.push({ name, rows });
  }
  if (problems.length) {
    console.error('Plan rejected:\n  ' + problems.join('\n  '));
    process.exitCode = 1;
    db.close();
    return;
  }

  // ---- work out each merge ----
  const merges = resolved.map(({ name, rows }) => {
    const ranked = rows.map(row => ({ row, refs: refCount(db, refs, row.id) }))
      .map(x => ({ ...x, score: score(x.row, x.refs) }))
      .sort((a, b) => b.score - a.score || a.row.id - b.row.id);
    const keeper = ranked[0].row;
    const losers = ranked.slice(1).map(x => x.row);
    const merged = {};
    for (const f of DETAIL_FIELDS) {
      if (hasValue(keeper[f])) continue;
      const donor = losers.find(l => hasValue(l[f]));
      if (donor) merged[f] = donor[f];
    }
    return { name, keeper, losers, merged, refsMoved: ranked.slice(1).reduce((s, x) => s + x.refs, 0) };
  });

  let removed = 0;
  for (const m of merges) {
    removed += m.losers.length;
    const tag = m.losers.length ? 'MERGE ' : 'RENAME';
    console.log(`${tag} -> "${m.name}"   keep #${m.keeper.id} "${m.keeper.name}"${hasValue(m.keeper.image) ? ' [img]' : ''}${hasValue(m.keeper.description) ? ' [desc]' : ''}`);
    for (const l of m.losers) console.log(`         drop #${l.id} "${l.name}"`);
    const absorbed = Object.keys(m.merged);
    if (absorbed.length) console.log(`         absorbs ${absorbed.join(', ')}`);
    if (m.refsMoved) console.log(`         re-points ${m.refsMoved} reference row(s)`);
  }
  console.log(`\n${merges.length} entries, ${removed} rows to remove.`);

  if (!args.apply) {
    console.log('Dry run. Re-run with --apply to merge.');
    db.close();
    return;
  }

  const backup = path.join(require('../utils/storage').BACKUPS_DIR, `cims-before-merge-${new Date().toISOString().replace(/[:.]/g, '-')}.db`);
  db.exec(`VACUUM INTO '${backup.replace(/'/g, "''")}'`);
  console.log(`Snapshot: ${backup}`);

  const setFields = DETAIL_FIELDS.map(f => `${f} = ?`).join(', ');
  const updateKeeper = db.prepare(`UPDATE product_catalog SET name = ?, ${setFields} WHERE id = ?`);
  const deleteRow = db.prepare('DELETE FROM product_catalog WHERE id = ?');

  db.exec('BEGIN');
  try {
    for (const m of merges) {
      const values = DETAIL_FIELDS.map(f => (m.merged[f] !== undefined ? m.merged[f] : m.keeper[f]));
      for (const l of m.losers) {
        for (const { table, hasName } of refs) {
          db.prepare(`UPDATE ${table} SET catalog_id = ?${hasName ? ', name = ?' : ''} WHERE catalog_id = ?`)
            .run(...(hasName ? [m.keeper.id, m.name, l.id] : [m.keeper.id, l.id]));
        }
        deleteRow.run(l.id);
      }
      updateKeeper.run(m.name, ...values, m.keeper.id);
      for (const { table, hasName } of refs) {
        if (hasName) db.prepare(`UPDATE ${table} SET name = ? WHERE catalog_id = ?`).run(m.name, m.keeper.id);
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
