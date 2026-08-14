// One-off migration: converts product_catalog.image values that are still
// base64 data URLs into actual files under data/catalog_images/, replacing
// the column value with a short /catalog-images/<uuid>.<ext> reference --
// same format the new POST /api/assets/upload-image endpoint produces for
// future uploads. Google Drive URLs and existing /catalog-images/ refs are
// left untouched.
//
// Usage: node migrate-catalog-images-to-files.js <db-path> [--apply]
// Without --apply, runs as a dry run and only prints what it would do.
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { DatabaseSync } = require('node:sqlite');

const dbPath = process.argv[2];
const apply = process.argv.includes('--apply');
if (!dbPath) {
  console.error('Usage: node migrate-catalog-images-to-files.js <db-path> [--apply]');
  process.exit(1);
}

const IMAGES_DIR = path.join(path.dirname(dbPath), 'catalog_images');
fs.mkdirSync(IMAGES_DIR, { recursive: true });

const EXT_BY_MIME = { 'image/jpeg': '.jpg', 'image/jpg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/avif': '.avif', 'image/gif': '.gif' };

function parseDataUrl(value) {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(value);
  if (!match) return null;
  const [, mime, base64] = match;
  const ext = EXT_BY_MIME[mime.toLowerCase()];
  if (!ext) return null;
  return { mime, ext, buffer: Buffer.from(base64, 'base64') };
}

const db = new DatabaseSync(dbPath);
db.exec('PRAGMA journal_mode = WAL');

const rows = db.prepare(`SELECT id, center_id, name, image FROM product_catalog WHERE image LIKE 'data:%'`).all();
console.log(`Found ${rows.length} product_catalog rows with an embedded base64 image.`);

let converted = 0, skippedUnknownFormat = 0, totalBytesBefore = 0, totalBytesAfter = 0;
const update = apply ? db.prepare('UPDATE product_catalog SET image = ? WHERE id = ?') : null;

for (const row of rows) {
  const parsed = parseDataUrl(row.image);
  totalBytesBefore += row.image.length;
  if (!parsed) {
    skippedUnknownFormat++;
    console.log(`  SKIP (unrecognized format) id=${row.id} center=${row.center_id} name="${row.name}"`);
    continue;
  }
  const filename = `${crypto.randomUUID()}${parsed.ext}`;
  const newValue = `/catalog-images/${filename}`;
  totalBytesAfter += newValue.length;
  converted++;
  if (apply) {
    fs.writeFileSync(path.join(IMAGES_DIR, filename), parsed.buffer);
    update.run(newValue, row.id);
  }
}

console.log(`\n${apply ? 'Converted' : 'Would convert'}: ${converted}`);
console.log(`Skipped (unrecognized format): ${skippedUnknownFormat}`);
console.log(`DB text size for these rows: ${(totalBytesBefore / 1024 / 1024).toFixed(1)}MB -> ${(totalBytesAfter / 1024).toFixed(1)}KB`);

// The one known corrupted record found during investigation: a Google
// Drive URL got spliced into the middle of a local-path-looking string
// ("/catalog-images/dht11.j" + drive URL + "pg"). Extract the real URL.
const corrupted = db.prepare(`SELECT id, center_id, name, image FROM product_catalog WHERE image LIKE '%dht11.j%drive.google.com%'`).all();
if (corrupted.length) {
  console.log(`\nFound ${corrupted.length} corrupted DHT11-style record(s):`);
  const driveUrlMatch = /https:\/\/drive\.google\.com\/[^\s]+/;
  for (const row of corrupted) {
    const m = driveUrlMatch.exec(row.image);
    const cleanUrl = m ? m[0].replace(/pg$/, '') : null;
    console.log(`  id=${row.id} center=${row.center_id} name="${row.name}" -> ${cleanUrl || '(could not extract clean URL, leaving as-is)'}`);
    if (apply && cleanUrl) {
      db.prepare('UPDATE product_catalog SET image = ? WHERE id = ?').run(cleanUrl, row.id);
    }
  }
}

// Orphan cleanup: files sitting in catalog_images/ that no product_catalog
// row (in any center) actually points at. Run this AFTER the conversion
// above so the newly-written files are correctly recognized as referenced.
const referenced = new Set(
  db.prepare(`SELECT image FROM product_catalog WHERE image LIKE '/catalog-images/%'`).all()
    .map(r => path.basename(r.image))
);
const onDisk = fs.readdirSync(IMAGES_DIR).filter(f => fs.statSync(path.join(IMAGES_DIR, f)).isFile());
const orphans = onDisk.filter(f => !referenced.has(f) && f.toLowerCase() !== 'sources.md');
if (orphans.length) {
  console.log(`\n${apply ? 'Deleting' : 'Would delete'} ${orphans.length} orphaned file(s) in catalog_images/ (not referenced by any center's catalog):`);
  for (const f of orphans) {
    console.log(`  ${f}`);
    if (apply) fs.unlinkSync(path.join(IMAGES_DIR, f));
  }
}

db.close();
console.log(apply ? '\nApplied.' : '\nDry run only -- pass --apply to write changes.');
