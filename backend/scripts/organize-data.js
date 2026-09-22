// Brings an existing data/ folder into the layout described in utils/storage.js.
//
//   invoice_documents/<id>/<timestamp>-<uuid>.pdf  ->  invoices/<CENTER>/<year>/<invoice no>/<original name>
//   catalog_images/<uuid>.webp (referenced)        ->  components/<component-name>.webp
//   catalog_images/<uuid>.webp (unreferenced)      ->  deleted (they are Comedkare leftovers)
//   *.before-*.db snapshots next to the database   ->  backups/
//
// Every database path is rewritten to the new relative form. Safe to re-run:
// anything already in place is left alone. Takes a database snapshot first.
//
// Usage: node organize-data.js [--db ../data/cims.db] [--apply]

const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');
const storage = require('../utils/storage');

function parseArgs(argv) {
  const args = { db: path.join(storage.DATA_ROOT, 'cims.db'), apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--db') args.db = argv[++i];
    else if (argv[i] === '--apply') args.apply = true;
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const db = new DatabaseSync(args.db);
  const actions = [];

  // ---- 1. invoice documents ----
  const docs = db.prepare(`
    SELECT d.id, d.file_name, d.storage_path, i.invoice_number, i.invoice_date, c.code AS center_code
    FROM invoice_documents d JOIN invoices i ON i.id = d.invoice_id JOIN centers c ON c.id = i.center_id
  `).all();
  for (const doc of docs) {
    const current = storage.resolveStored(doc.storage_path);
    const targetDir = storage.invoiceDocumentDir({ centerCode: doc.center_code, invoiceDate: doc.invoice_date, invoiceNumber: doc.invoice_number });
    const alreadyThere = path.dirname(current) === targetDir && !/^\d{13}-[0-9a-f-]{36}/.test(path.basename(current));
    if (alreadyThere && !path.isAbsolute(doc.storage_path)) continue;
    if (!fs.existsSync(current)) { actions.push({ kind: 'missing', from: current }); continue; }
    const target = alreadyThere ? current : storage.uniquePath(targetDir, storage.safeFilename(doc.file_name, path.basename(current)));
    actions.push({ kind: 'doc', id: doc.id, from: current, to: target });
  }

  // ---- 2. component photos ----
  const legacyDir = path.join(storage.DATA_ROOT, 'catalog_images');
  const rows = db.prepare("SELECT id, name, image FROM product_catalog WHERE image LIKE '/catalog-images/%'").all();
  const referenced = new Set();
  const plannedTargets = new Set();
  const plannedSources = new Set();
  for (const row of rows) {
    const file = row.image.replace('/catalog-images/', '');
    referenced.add(file);
    const inLegacy = path.join(legacyDir, file);
    const inNew = path.join(storage.COMPONENT_IMAGES_DIR, file);
    const current = fs.existsSync(inNew) ? inNew : inLegacy;
    const wantedStem = storage.slugify(row.name);
    const ext = path.extname(file).toLowerCase();
    if (!fs.existsSync(current)) {
      // The file may already have been renamed to its component name by an
      // earlier run whose database update did not land. Re-link it.
      const recovered = [`${wantedStem}${ext}`, `${wantedStem} (2)${ext}`].map(f => path.join(storage.COMPONENT_IMAGES_DIR, f)).find(f => fs.existsSync(f));
      if (recovered) actions.push({ kind: 'relink', id: row.id, from: current, to: recovered, url: `/catalog-images/${path.basename(recovered)}` });
      else actions.push({ kind: 'missing', from: current, row: row.id });
      continue;
    }
    // Already named after the component and living in components/ -> done.
    if (current === inNew && path.basename(file, ext) === wantedStem) continue;
    // Two rows sharing one file: rename it once, re-point both.
    if (plannedSources.has(current)) {
      const prior = actions.find(x => x.kind === 'image' && x.from === current);
      actions.push({ kind: 'relink', id: row.id, from: current, to: prior.to, url: prior.url });
      continue;
    }
    plannedSources.add(current);
    let target = path.join(storage.COMPONENT_IMAGES_DIR, `${wantedStem}${ext}`);
    let n = 2;
    while (plannedTargets.has(target) || (fs.existsSync(target) && target !== current)) {
      target = path.join(storage.COMPONENT_IMAGES_DIR, `${wantedStem} (${n})${ext}`);
      n += 1;
    }
    plannedTargets.add(target);
    actions.push({ kind: 'image', id: row.id, from: current, to: target, url: `/catalog-images/${path.basename(target)}` });
  }
  const unreferenced = fs.existsSync(legacyDir)
    ? fs.readdirSync(legacyDir).filter(f => !referenced.has(f) && f !== 'desktop.ini')
    : [];

  // ---- 3. stray snapshots ----
  const strays = fs.readdirSync(storage.DATA_ROOT).filter(f => /\.before-.*\.db$/.test(f));

  console.log(`Invoice documents to file: ${actions.filter(a => a.kind === 'doc').length}`);
  console.log(`Component photos to rename: ${actions.filter(a => a.kind === 'image').length}`);
  console.log(`Catalog rows to re-link to an already-renamed photo: ${actions.filter(a => a.kind === 'relink').length}`);
  console.log(`Unreferenced legacy photos to delete: ${unreferenced.length}`);
  console.log(`Snapshots to move into backups/: ${strays.length}`);
  const missing = actions.filter(a => a.kind === 'missing');
  if (missing.length) console.log(`Files recorded but not on disk (left as-is): ${missing.length}`);
  for (const a of actions.filter(a => a.kind !== 'missing').slice(0, 12)) {
    console.log(`  ${path.relative(storage.DATA_ROOT, a.from)}  ->  ${path.relative(storage.DATA_ROOT, a.to)}`);
  }
  if (actions.length > 12) console.log('  ...');

  if (!args.apply) { console.log('\nDry run. Re-run with --apply.'); db.close(); return; }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  db.exec(`VACUUM INTO '${path.join(storage.BACKUPS_DIR, `cims-before-organize-${stamp}.db`).replace(/'/g, "''")}'`);

  // One file, one database update, committed together -- a rename on disk is
  // not transactional, so a single big transaction could roll the database
  // back while files had already moved.
  for (const a of actions) {
    if (a.kind === 'doc') {
      if (a.from !== a.to) fs.renameSync(a.from, a.to);
      db.prepare('UPDATE invoice_documents SET storage_path = ? WHERE id = ?').run(storage.toRelative(a.to), a.id);
    } else if (a.kind === 'image') {
      fs.renameSync(a.from, a.to);
      db.prepare('UPDATE product_catalog SET image = ? WHERE id = ?').run(a.url, a.id);
    } else if (a.kind === 'relink') {
      db.prepare('UPDATE product_catalog SET image = ? WHERE id = ?').run(a.url, a.id);
    }
  }

  for (const f of unreferenced) fs.rmSync(path.join(legacyDir, f), { force: true });
  for (const f of strays) fs.renameSync(path.join(storage.DATA_ROOT, f), path.join(storage.BACKUPS_DIR, f));

  // Remove the old folders once empty.
  for (const dir of [legacyDir, path.join(storage.DATA_ROOT, 'invoice_documents')]) {
    if (!fs.existsSync(dir)) continue;
    const leftovers = fs.readdirSync(dir, { recursive: true })
      .filter(f => fs.statSync(path.join(dir, String(f))).isFile() && !/desktop\.ini$/i.test(String(f)));
    if (leftovers.length === 0) fs.rmSync(dir, { recursive: true, force: true });
    else console.log(`Left ${dir} in place: ${leftovers.length} unexpected file(s) remain.`);
  }

  db.close();
  console.log('Done.');
}

try { main(); } catch (error) { console.error(`\nFailed: ${error.message}\n`); process.exitCode = 1; }
