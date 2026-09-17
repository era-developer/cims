const { getDb } = require('./db');

// The in-portal notification centre (the bell). Every event that reaches a
// person by e-mail or push is also written here, so the record is complete
// even for someone who never enabled push on any device.

const RETENTION_DAYS = 180;
const PAGE_MAX = 100;

function record(userId, { kind, title, body, url, ref }) {
  if (!userId || !title) return null;
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO notifications (user_id, kind, title, body, url, ref)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(userId, kind || 'general', String(title), String(body || ''), url || null, ref || null);
  return Number(result.lastInsertRowid);
}

function recordMany(userIds, payload) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  const db = getDb();
  db.exec('BEGIN');
  try {
    for (const id of ids) record(id, payload);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return ids.length;
}

// Same audience rule as push: the center's own admins plus every super admin,
// minus the person who performed the action.
function centerAdminIds(centerId, { excludeUserId } = {}) {
  return getDb().prepare(`
    SELECT id FROM users
    WHERE active = 1
      AND (role = 'super_admin' OR (role = 'admin' AND center_id = ?))
      AND (? IS NULL OR id <> ?)
  `).all(centerId || '', excludeUserId || null, excludeUserId || null).map(r => r.id);
}

function serialize(row) {
  return {
    id: row.id, kind: row.kind, title: row.title, body: row.body, url: row.url || '', ref: row.ref || '',
    createdAt: row.created_at, readAt: row.read_at || null, read: !!row.read_at,
  };
}

function list(userId, { limit = 30, before = null, unreadOnly = false } = {}) {
  const size = Math.min(Math.max(Number(limit) || 30, 1), PAGE_MAX);
  const rows = getDb().prepare(`
    SELECT * FROM notifications
    WHERE user_id = ?
      AND (? IS NULL OR id < ?)
      AND (? = 0 OR read_at IS NULL)
    ORDER BY id DESC LIMIT ?
  `).all(userId, before || null, before || null, unreadOnly ? 1 : 0, size + 1);
  const hasMore = rows.length > size;
  return { items: rows.slice(0, size).map(serialize), hasMore, nextBefore: hasMore ? rows[size - 1].id : null };
}

function unreadCount(userId) {
  return getDb().prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(userId).n;
}

function markRead(userId, id) {
  return getDb().prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL')
    .run(new Date().toISOString(), Number(id), userId).changes;
}

function markAllRead(userId) {
  return getDb().prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL')
    .run(new Date().toISOString(), userId).changes;
}

// Called from the hourly job: old read entries fall off so the table does not
// grow forever. Unread ones are kept a further period in case nobody looked.
function prune() {
  const db = getDb();
  const readGone = db.prepare(`DELETE FROM notifications WHERE read_at IS NOT NULL AND created_at < datetime('now', ?)`)
    .run(`-${RETENTION_DAYS} days`).changes;
  const unreadGone = db.prepare(`DELETE FROM notifications WHERE read_at IS NULL AND created_at < datetime('now', ?)`)
    .run(`-${RETENTION_DAYS * 2} days`).changes;
  return readGone + unreadGone;
}

module.exports = { record, recordMany, centerAdminIds, list, unreadCount, markRead, markAllRead, prune, RETENTION_DAYS };
