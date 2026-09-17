// Carries component photos (and descriptions) over from a CIMS database into
// the KIMS catalog, matched by item name.
//
// Photos in CIMS are generic component pictures -- an Arduino Mega looks the
// same in Lucknow as in Bengaluru -- referenced from product_catalog.image as
// either an external Google Drive URL or a local /catalog-images/<uuid> path.
// Both are plain strings, so linking is a copy of the string; the local files
// are served from backend/data/catalog_images, which KIMS keeps.
//
// The same name may carry different images across the nine Comedkare centers.
// The most frequently used one wins, so a single center's one-off upload does
// not override the picture the other eight agreed on.
//
// Only fills blanks: an item that already has an image in KIMS is left alone.
//
// Usage:
//   node link-catalog-images.js --db ../data/kims.db [--from D:/cims/backend/data/cims.db] [--apply]

const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

function parseArgs(argv) {
  const args = {
    db: path.join(__dirname, '..', 'data', 'kims.db'),
    from: 'D:/cims/backend/data/cims.db',
    apply: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--db') args.db = argv[++i];
    else if (argv[i] === '--from') args.from = argv[++i];
    else if (argv[i] === '--apply') args.apply = true;
  }
  return args;
}

function readImageMaster(sourcePath) {
  if (!fs.existsSync(sourcePath)) throw new Error(`Source database not found: ${sourcePath}`);
  const source = new DatabaseSync(sourcePath, { readOnly: true });
  try {
    // Ordered by votes DESC within each name, so the first row seen per name
    // is the majority choice.
    const rows = source.prepare(`
      SELECT name, image, description, COUNT(*) AS votes
      FROM product_catalog
      WHERE image IS NOT NULL AND TRIM(image) <> ''
      GROUP BY name, image, description
      ORDER BY name COLLATE NOCASE, votes DESC
    `).all();
    const byName = new Map();
    for (const row of rows) {
      if (!byName.has(row.name)) byName.set(row.name, { image: row.image, description: row.description || null });
    }
    return byName;
  } finally {
    source.close();
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const master = readImageMaster(args.from);

  const db = new DatabaseSync(args.db);
  const targets = db.prepare(`
    SELECT id, name FROM product_catalog
    WHERE image IS NULL OR TRIM(image) = ''
  `).all();

  const matched = targets.filter(t => master.has(t.name));
  const localMissing = [];
  for (const t of matched) {
    const { image } = master.get(t.name);
    if (image.startsWith('/catalog-images/')) {
      const file = path.join(__dirname, '..', 'data', 'catalog_images', image.replace('/catalog-images/', ''));
      if (!fs.existsSync(file)) localMissing.push({ name: t.name, image });
    }
  }

  console.log(`Catalog items without a photo : ${targets.length}`);
  console.log(`  matched to a source photo   : ${matched.length}`);
  console.log(`  no source photo available   : ${targets.length - matched.length}`);
  if (localMissing.length) {
    console.log(`  local file missing (skipped): ${localMissing.length}`);
  }

  if (!args.apply) {
    console.log('\nDry run. Re-run with --apply to write.');
    db.close();
    return;
  }

  const skip = new Set(localMissing.map(m => m.name));
  const update = db.prepare(`
    UPDATE product_catalog
    SET image = ?, description = COALESCE(description, ?)
    WHERE id = ?
  `);
  let written = 0;
  db.exec('BEGIN');
  try {
    for (const t of matched) {
      if (skip.has(t.name)) continue;
      const { image, description } = master.get(t.name);
      update.run(image, description, t.id);
      written += 1;
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    db.close();
    throw error;
  }
  db.close();
  console.log(`\nLinked ${written} photos.`);
}

try {
  main();
} catch (error) {
  console.error(`\nFailed: ${error.message}\n`);
  process.exitCode = 1;
}
