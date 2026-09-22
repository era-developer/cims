const { getDb } = require('./db');

// Business heads are the funding entities an invoice is booked against
// ("ERA Foundation", and for Comedkare also "ComedK"). The table has existed
// since 001_init.sql, but its rows were only ever inserted by migration
// scripts, and the dashboard hardcoded the two Comedkare names. A super admin
// can now add more from Settings, so this module owns the table and the UI
// reads it.

// Sentinel row name used by legacy reports for invoices with no head. Never
// offered in forms and never editable.
const UNSPECIFIED = 'Unspecified';

function rowToHead(row) {
  return { id: row.id, name: row.name, active: row.active === 1 || row.active === true };
}

function listBusinessHeads({ includeInactive = false } = {}) {
  const rows = getDb().prepare(
    'SELECT id, name, active FROM business_heads WHERE name != ? ORDER BY name COLLATE NOCASE'
  ).all(UNSPECIFIED);
  const heads = rows.map(rowToHead);
  return includeInactive ? heads : heads.filter(head => head.active);
}

function getBusinessHeadById(id) {
  const row = getDb().prepare('SELECT id, name, active FROM business_heads WHERE id = ?').get(id);
  return row ? rowToHead(row) : null;
}

function validateName(name, { existingId = null } = {}) {
  const clean = String(name || '').trim().replace(/\s+/g, ' ');
  if (!clean) throw badRequest('Business head name is required');
  if (clean.length > 80) throw badRequest('Business head name must be 80 characters or fewer');
  if (clean.toLowerCase() === UNSPECIFIED.toLowerCase()) {
    throw badRequest(`"${UNSPECIFIED}" is reserved`);
  }
  const clash = getDb().prepare(
    'SELECT id FROM business_heads WHERE LOWER(name) = LOWER(?)'
  ).get(clean);
  if (clash && clash.id !== existingId) {
    throw badRequest(`A business head named "${clean}" already exists`);
  }
  return clean;
}

function badRequest(message) {
  const error = new Error(message);
  error.status = 400;
  return error;
}

function createBusinessHead({ name }) {
  const clean = validateName(name);
  const id = getDb().prepare('INSERT INTO business_heads (name, active) VALUES (?, 1)').run(clean).lastInsertRowid;
  return getBusinessHeadById(id);
}

function updateBusinessHead(id, patch = {}) {
  const existing = getBusinessHeadById(id);
  if (!existing) throw Object.assign(new Error('Business head not found'), { status: 404 });

  const name = patch.name === undefined ? existing.name : validateName(patch.name, { existingId: existing.id });
  const active = patch.active === undefined ? existing.active : Boolean(patch.active);

  getDb().prepare('UPDATE business_heads SET name = ?, active = ? WHERE id = ?').run(name, active ? 1 : 0, id);
  return getBusinessHeadById(id);
}

// Invoices and projects both point at a head. Counted before a delete so a
// head that has been booked against is deactivated rather than orphaning the
// invoices that reference it.
function countReferences(id) {
  const db = getDb();
  const refs = {};
  for (const table of ['invoices', 'projects']) {
    try {
      const row = db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE business_head_id = ?`).get(id);
      if (row && row.n > 0) refs[table] = row.n;
    } catch {
      // Table absent in an older schema means no references.
    }
  }
  return refs;
}

function deleteBusinessHead(id) {
  const existing = getBusinessHeadById(id);
  if (!existing) throw Object.assign(new Error('Business head not found'), { status: 404 });

  const references = countReferences(id);
  if (Object.keys(references).length > 0) {
    updateBusinessHead(id, { active: false });
    return { deleted: false, deactivated: true, references };
  }

  getDb().prepare('DELETE FROM business_heads WHERE id = ?').run(id);
  return { deleted: true, deactivated: false, references: {} };
}

module.exports = {
  UNSPECIFIED,
  listBusinessHeads,
  getBusinessHeadById,
  createBusinessHead,
  updateBusinessHead,
  deleteBusinessHead,
  countReferences,
};
