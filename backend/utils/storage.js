const fs = require('fs');
const path = require('path');

// One place that knows where files live on disk.
//
// Everything the portal stores sits under backend/data in a layout a person
// can navigate without the database:
//
//   data/
//     cims.db                      the database
//     backups/                     nightly snapshots (see scripts/backup-db.js)
//     components/                  one photo per component, named after it
//       arduino-uno-r3.webp
//     invoices/                    vendor invoice scans
//       JPN/2026/INV-0042/         <center code>/<year>/<invoice number>/
//         Project Details.pdf        the file keeps its original name
//
// Paths recorded in the database are RELATIVE to data/ ("invoices/JPN/..."),
// so the whole folder can be moved or restored elsewhere and every link still
// resolves. Absolute paths from before this module are still accepted when
// reading, so nothing already uploaded breaks.

const DATA_ROOT = path.join(__dirname, '..', 'data');
const COMPONENT_IMAGES_DIR = path.join(DATA_ROOT, 'components');
const INVOICES_DIR = path.join(DATA_ROOT, 'invoices');
const BACKUPS_DIR = path.join(DATA_ROOT, 'backups');

for (const dir of [COMPONENT_IMAGES_DIR, INVOICES_DIR, BACKUPS_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

// "Arduino UNO R3 (compatible)" -> "arduino-uno-r3-compatible"
function slugify(value, max = 60) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '');
}

// Keeps a human-supplied filename readable while removing anything Windows
// or a URL would object to. "Project: Details?.pdf" -> "Project Details.pdf"
function safeFilename(value, fallback = 'file') {
  const base = path.basename(String(value || ''));
  const cleaned = base.replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').trim();
  return cleaned || fallback;
}

// Folder-name safe version of an invoice number: "INV/2026-42" -> "INV-2026-42"
function safeSegment(value, fallback = 'unknown') {
  const cleaned = String(value || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/\s+/g, ' ').trim().replace(/\.+$/, '');
  return cleaned || fallback;
}

// Returns a path in `dir` that does not exist yet: "name.pdf", then
// "name (2).pdf", "name (3).pdf" ... Same convention Windows Explorer uses.
function uniquePath(dir, filename) {
  const ext = path.extname(filename);
  const stem = filename.slice(0, filename.length - ext.length);
  let candidate = path.join(dir, filename);
  let n = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${stem} (${n})${ext}`);
    n += 1;
  }
  return candidate;
}

function toRelative(absolutePath) {
  const rel = path.relative(DATA_ROOT, absolutePath);
  return rel.split(path.sep).join('/');
}

// Accepts the relative form stored now, or the absolute form stored before.
function resolveStored(storedPath) {
  if (!storedPath) return '';
  if (path.isAbsolute(storedPath)) return storedPath;
  return path.join(DATA_ROOT, ...String(storedPath).split('/'));
}

// invoices/<CENTER CODE>/<YYYY>/<INVOICE NUMBER>/
function invoiceDocumentDir({ centerCode, invoiceDate, invoiceNumber }) {
  const year = /^\d{4}/.test(String(invoiceDate || '')) ? String(invoiceDate).slice(0, 4) : String(new Date().getFullYear());
  const dir = path.join(INVOICES_DIR, safeSegment(centerCode, 'CENTER'), year, safeSegment(invoiceNumber, 'no-number'));
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// components/<component-slug>.<ext>; falls back to a short random stem when
// the upload arrives before the component has a name.
function componentImagePath(componentName, ext) {
  const cleanExt = (ext || '.jpg').toLowerCase().replace(/[^a-z0-9.]/g, '') || '.jpg';
  const stem = slugify(componentName) || `photo-${Date.now().toString(36)}`;
  return uniquePath(COMPONENT_IMAGES_DIR, `${stem}${cleanExt.startsWith('.') ? cleanExt : `.${cleanExt}`}`);
}

module.exports = {
  DATA_ROOT,
  COMPONENT_IMAGES_DIR,
  INVOICES_DIR,
  BACKUPS_DIR,
  slugify,
  safeFilename,
  safeSegment,
  uniquePath,
  toRelative,
  resolveStored,
  invoiceDocumentDir,
  componentImagePath,
};
