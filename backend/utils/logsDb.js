const { getDb } = require('./db');
const { requireCenter } = require('./centers');

async function logActivity(action, user, details = {}) {
  const centerId = details.centerId || '';
  if (!centerId) return;
  const centerName = requireCenter(centerId).name;
  getDb().prepare(`
    INSERT INTO activity_logs (center_id, center_name, username, role, action, details)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(centerId, centerName, user, details.role || '', action, details.info || '');
}

function getLogs(centerId) {
  const center = requireCenter(centerId);
  return getDb().prepare(`
    SELECT center_id AS centerId, center_name AS centerName, username AS user, role, action, details, created_at AS ts
    FROM activity_logs WHERE center_id = ? ORDER BY created_at DESC
  `).all(center.id);
}

module.exports = { logActivity, getLogs };
