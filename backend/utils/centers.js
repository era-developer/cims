const { getDb } = require('./db');
const { normalizePhone } = require('./settings');

// Centers used to be a hardcoded array in this file, mirrored by hand into
// frontend/src/centers.js and seeded by scripts/migrate-to-sqlite.js. Adding a
// center therefore meant a code change in two places plus a redeploy. The
// `centers` table has existed since 001_init.sql and is already the foreign
// key target for users, assets, catalog, students, invoices and transfers, so
// it is now the single source of truth and this module is a thin accessor
// over it. Callers that previously imported the `CENTERS` constant should call
// listCenters() instead -- a module-level constant cannot see a center added
// after the process booted.

// Center lists are read on nearly every admin request (the dashboard loops
// over them twice) and written only when a super admin adds or edits one, so
// the table is cached in-process and invalidated by the writers below.
let cache = null;

function invalidate() {
  cache = null;
}

function rowToCenter(row) {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    active: row.active === 1 || row.active === true,
    notificationEmail: row.notification_email || '',
    whatsappNumber: row.whatsapp_number || '',
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
  };
}

function loadAll() {
  if (cache) return cache;
  const rows = getDb().prepare(`
    SELECT id, code, name, active, notification_email, whatsapp_number, created_at, updated_at
    FROM centers
    ORDER BY name COLLATE NOCASE
  `).all();
  cache = rows.map(rowToCenter);
  return cache;
}

// Defaults to active centers only. Deactivated centers still own historical
// assets, orders and invoices, so reports that walk history pass
// { includeInactive: true } rather than losing those rows.
function listCenters({ includeInactive = false } = {}) {
  const all = loadAll();
  return includeInactive ? all.slice() : all.filter(center => center.active);
}

function getCenterById(centerId) {
  if (!centerId) return null;
  return loadAll().find(center => center.id === centerId) || null;
}

function requireCenter(centerId) {
  const center = getCenterById(centerId);
  if (!center) {
    throw new Error(`Unknown center: ${centerId}`);
  }
  return center;
}

// ---------- Validation ----------

// Center ids are embedded in env-var names ({CENTER_ID}_EMAIL) and used as
// object keys throughout the frontend, so they are restricted to the same
// lower_snake_case shape the original hardcoded ids used.
function slugifyId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40);
}

function normalizeCode(value) {
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

// Derives "J P Nagar, Bengaluru" -> "JPNB". Only used to prefill the form; a super
// admin can always override it, since asset tags carry the code and a center's
// tags should stay stable once printed.
function suggestCode(name) {
  const words = String(name || '').trim().split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (!words.length) return '';
  if (words.length === 1) return normalizeCode(words[0].slice(0, 3));
  return normalizeCode(words.map(word => word[0]).join(''));
}

function validateCenterInput({ id, code, name }, { existingId = null } = {}) {
  const errors = [];
  const cleanName = String(name || '').trim();
  const cleanCode = normalizeCode(code);

  // A name written in a non-Latin script (Devanagari, Kannada, ...) slugifies
  // to nothing, which would block a perfectly valid center. The code is
  // already required and ASCII, so it makes a stable fallback id.
  const cleanId = existingId || slugifyId(id || name) || slugifyId(cleanCode);

  if (!cleanName) errors.push('Center name is required');
  if (cleanName.length > 120) errors.push('Center name must be 120 characters or fewer');
  if (!cleanId) errors.push('Center ID could not be derived from the name; provide one explicitly');
  if (!cleanCode) errors.push('Center code is required');
  if (cleanCode.length < 2) errors.push('Center code must be at least 2 characters');

  const all = loadAll();
  if (!existingId && all.some(center => center.id === cleanId)) {
    errors.push(`A center with ID "${cleanId}" already exists`);
  }
  if (all.some(center => center.code === cleanCode && center.id !== existingId)) {
    errors.push(`Center code "${cleanCode}" is already used by another center`);
  }
  if (all.some(center => center.name.toLowerCase() === cleanName.toLowerCase() && center.id !== existingId)) {
    errors.push(`A center named "${cleanName}" already exists`);
  }

  return { errors, value: { id: cleanId, code: cleanCode, name: cleanName } };
}

// ---------- Mutations ----------

function createCenter({ id, code, name, notificationEmail = '', whatsappNumber = '', active = true }) {
  const { errors, value } = validateCenterInput({ id, code, name });
  if (errors.length) {
    const error = new Error(errors[0]);
    error.validationErrors = errors;
    error.status = 400;
    throw error;
  }

  getDb().prepare(`
    INSERT INTO centers (id, code, name, active, notification_email, whatsapp_number, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
  `).run(
    value.id,
    value.code,
    value.name,
    active ? 1 : 0,
    String(notificationEmail || '').trim() || null,
    normalizePhone(whatsappNumber) || null
  );

  invalidate();
  return requireCenter(value.id);
}

function updateCenter(centerId, patch = {}) {
  const existing = requireCenter(centerId);
  const next = {
    code: patch.code === undefined ? existing.code : patch.code,
    name: patch.name === undefined ? existing.name : patch.name,
  };

  const { errors, value } = validateCenterInput(
    { id: centerId, code: next.code, name: next.name },
    { existingId: centerId }
  );
  if (errors.length) {
    const error = new Error(errors[0]);
    error.validationErrors = errors;
    error.status = 400;
    throw error;
  }

  const notificationEmail = patch.notificationEmail === undefined
    ? existing.notificationEmail
    : String(patch.notificationEmail || '').trim();
  const whatsappNumber = patch.whatsappNumber === undefined
    ? existing.whatsappNumber
    : normalizePhone(patch.whatsappNumber);
  const active = patch.active === undefined ? existing.active : Boolean(patch.active);

  getDb().prepare(`
    UPDATE centers
    SET code = ?, name = ?, active = ?, notification_email = ?, whatsapp_number = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    value.code,
    value.name,
    active ? 1 : 0,
    notificationEmail || null,
    whatsappNumber || null,
    centerId
  );

  invalidate();
  return requireCenter(centerId);
}

// Tables that point at a center and would orphan history if the row vanished.
// Checked before a hard delete so a center that has ever been used is
// deactivated instead -- its assets, orders and invoices must stay auditable.
const CENTER_REFERENCE_TABLES = [
  ['users', 'center_id'],
  ['students', 'center_id'],
  ['product_catalog', 'center_id'],
  ['assets', 'center_id'],
  ['issue_records', 'center_id'],
  ['invoices', 'center_id'],
  ['projects', 'center_id'],
];

function countCenterReferences(centerId) {
  const db = getDb();
  const counts = {};
  for (const [table, column] of CENTER_REFERENCE_TABLES) {
    try {
      const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`).get(centerId);
      if (row && row.n > 0) counts[table] = row.n;
    } catch {
      // Table may not exist in an older database; absence means no references.
    }
  }
  // Transfers reference two centers.
  try {
    const row = db.prepare(
      'SELECT COUNT(*) AS n FROM transfers WHERE from_center_id = ? OR to_center_id = ?'
    ).get(centerId, centerId);
    if (row && row.n > 0) counts.transfers = row.n;
  } catch {
    // Same as above.
  }
  return counts;
}

function setCenterActive(centerId, active) {
  requireCenter(centerId);
  getDb().prepare('UPDATE centers SET active = ?, updated_at = datetime(\'now\') WHERE id = ?')
    .run(active ? 1 : 0, centerId);
  invalidate();
  return requireCenter(centerId);
}

// Hard-deletes only a center that has never been used. Anything else is
// deactivated, and the caller is told which tables held it back.
function deleteCenter(centerId) {
  requireCenter(centerId);
  const references = countCenterReferences(centerId);

  if (Object.keys(references).length > 0) {
    setCenterActive(centerId, false);
    return { deleted: false, deactivated: true, references };
  }

  getDb().prepare('DELETE FROM centers WHERE id = ?').run(centerId);
  invalidate();
  return { deleted: true, deactivated: false, references: {} };
}

module.exports = {
  listCenters,
  getCenterById,
  requireCenter,
  createCenter,
  updateCenter,
  setCenterActive,
  deleteCenter,
  countCenterReferences,
  slugifyId,
  normalizeCode,
  suggestCode,
  invalidate,
};
