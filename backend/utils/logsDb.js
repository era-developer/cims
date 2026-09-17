const { getDb } = require('./db');
const { getCenterById } = require('./centers');

// Org-level events (settings changes, center management) belong in the audit
// trail but have no single center to file under. activity_logs.center_id has
// always been nullable; this constant just gives those rows a readable label.
const ORG_SCOPE_NAME = 'Organization';

async function logActivity(action, user, details = {}) {
  const centerId = details.centerId || null;

  // Resolved leniently rather than via requireCenter(): a center_deleted entry
  // is written after the row is gone, and losing the audit record because its
  // subject no longer exists would defeat the point of the audit record.
  const center = centerId ? getCenterById(centerId) : null;
  const centerName = center ? center.name : (centerId ? centerId : ORG_SCOPE_NAME);

  getDb().prepare(`
    INSERT INTO activity_logs (center_id, center_name, username, role, action, details)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(centerId, centerName, user, details.role || '', action, details.info || '');
}

function getLogs(centerId) {
  const { requireCenter } = require('./centers');
  const center = requireCenter(centerId);
  return getDb().prepare(`
    SELECT center_id AS centerId, center_name AS centerName, username AS user, role, action, details, created_at AS ts
    FROM activity_logs WHERE center_id = ? ORDER BY created_at DESC
  `).all(center.id);
}

// Org-level entries are invisible to getLogs(centerId) by construction, so the
// super admin's audit view reads them through here.
function getOrgLogs() {
  return getDb().prepare(`
    SELECT center_id AS centerId, center_name AS centerName, username AS user, role, action, details, created_at AS ts
    FROM activity_logs WHERE center_id IS NULL ORDER BY created_at DESC
  `).all();
}

module.exports = { logActivity, getLogs, getOrgLogs, ORG_SCOPE_NAME };
