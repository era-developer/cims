const express = require('express');
const { getDb } = require('../utils/db');
const { authMiddleware, adminOnly } = require('../middleware/auth');
const settings = require('../utils/settings');
const push = require('../utils/push');
const { getAdminRecipient, sendSupportQuestionEmail, sendSupportReplyEmail } = require('../utils/email');
const { logActivity } = require('../utils/logsDb');

// Help bubble questions ("Ask us") and the admin Support inbox.
//
// A thread belongs to the person who asked and to their center. Center
// admins see their own center's threads; super admins see every center's.
// Anyone with access can write on a thread; a message from the asker puts
// it back to `open`, a message from an admin sets `answered`, and either
// side can close it. No real-time delivery yet: the bell, push and email
// carry each message, and the panel refetches when opened.

const router = express.Router();

const MAX_SUBJECT = 120;
const MAX_MESSAGE = 2000;
const PAGE_MAX = 100;

function isAdminRole(role) {
  return role === 'admin' || role === 'super_admin';
}

function loadThread(db, id) {
  return db.prepare(`
    SELECT t.*, u.username AS user_username, u.full_name AS user_full_name, u.email AS user_email,
           u.mobile AS user_mobile, u.role AS user_role, c.name AS center_name
    FROM support_threads t
    JOIN users u ON u.id = t.user_id
    LEFT JOIN centers c ON c.id = t.center_id
    WHERE t.id = ?
  `).get(id);
}

function canAccess(user, thread) {
  if (!thread) return false;
  if (thread.user_id === user.id) return true;
  if (user.role === 'super_admin') return true;
  if (user.role === 'admin') return !!thread.center_id && thread.center_id === user.centerId;
  return false;
}

function serializeThread(row, { messageCount = null, lastMessage = null } = {}) {
  return {
    id: row.id,
    centerId: row.center_id || '',
    centerName: row.center_name || '',
    userId: row.user_id,
    username: row.user_username || '',
    userName: row.user_full_name || row.user_username || '',
    userRole: row.user_role || '',
    subject: row.subject || '',
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMessageAt: row.last_message_at,
    closedAt: row.closed_at || null,
    closedBy: row.closed_by || null,
    messageCount,
    lastMessage,
  };
}

function serializeMessage(row) {
  return {
    id: row.id,
    threadId: row.thread_id,
    senderUserId: row.sender_user_id,
    senderRole: row.sender_role,
    senderName: row.sender_name || row.sender_username || (isAdminRole(row.sender_role) ? 'Center admin' : 'You'),
    body: row.body,
    createdAt: row.created_at,
  };
}

function loadMessages(db, threadId) {
  return db.prepare(`
    SELECT m.*, u.full_name AS sender_name, u.username AS sender_username
    FROM support_messages m
    LEFT JOIN users u ON u.id = m.sender_user_id
    WHERE m.thread_id = ?
    ORDER BY m.id
  `).all(threadId).map(serializeMessage);
}

function cleanMessage(value) {
  const text = String(value || '').replace(/\r\n/g, '\n').trim();
  if (!text) throw Object.assign(new Error('Write a message first.'), { status: 400 });
  if (text.length > MAX_MESSAGE) throw Object.assign(new Error(`Keep the message under ${MAX_MESSAGE} characters.`), { status: 400 });
  return text;
}

function cleanSubject(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, MAX_SUBJECT);
}

// Who hears about a new question: the center's mailbox (or the support /
// super admin mailbox when the asker has no center).
function questionRecipient(centerId) {
  return centerId ? getAdminRecipient(centerId) : settings.getSupportEmail();
}

// ---- listing ----
// ?scope=mine (default)  -> threads I started
// ?scope=inbox           -> admin: my center's threads; super admin: all (or ?centerId=)
// ?status=open|answered|closed|all (inbox default: everything but closed)
router.get('/threads', authMiddleware, (req, res) => {
  const db = getDb();
  const scope = req.query.scope === 'inbox' && isAdminRole(req.user.role) ? 'inbox' : 'mine';
  const status = String(req.query.status || '').trim();
  const clauses = [];
  const params = [];

  if (scope === 'mine') {
    clauses.push('t.user_id = ?');
    params.push(req.user.id);
  } else if (req.user.role === 'admin') {
    clauses.push('t.center_id = ?');
    params.push(req.user.centerId || '');
  } else if (req.query.centerId) {
    clauses.push('t.center_id = ?');
    params.push(String(req.query.centerId));
  }

  if (status && status !== 'all') {
    clauses.push('t.status = ?');
    params.push(status);
  } else if (scope === 'inbox' && !status) {
    clauses.push("t.status <> 'closed'");
  }

  const limit = Math.min(Math.max(Number(req.query.limit) || 50, 1), PAGE_MAX);
  const rows = db.prepare(`
    SELECT t.*, u.username AS user_username, u.full_name AS user_full_name, u.role AS user_role, c.name AS center_name,
           (SELECT COUNT(*) FROM support_messages m WHERE m.thread_id = t.id) AS message_count,
           (SELECT m.body FROM support_messages m WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_body,
           (SELECT m.sender_role FROM support_messages m WHERE m.thread_id = t.id ORDER BY m.id DESC LIMIT 1) AS last_role
    FROM support_threads t
    JOIN users u ON u.id = t.user_id
    LEFT JOIN centers c ON c.id = t.center_id
    ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
    ORDER BY CASE t.status WHEN 'open' THEN 0 WHEN 'answered' THEN 1 ELSE 2 END, t.last_message_at DESC
    LIMIT ?
  `).all(...params, limit);

  res.json(rows.map(row => serializeThread(row, {
    messageCount: row.message_count,
    lastMessage: row.last_body ? { body: String(row.last_body).slice(0, 160), senderRole: row.last_role } : null,
  })));
});

// Open-question count for the admin nav badge.
router.get('/inbox-count', authMiddleware, adminOnly, (req, res) => {
  const db = getDb();
  const row = req.user.role === 'admin'
    ? db.prepare("SELECT COUNT(*) AS n FROM support_threads WHERE status = 'open' AND center_id = ?").get(req.user.centerId || '')
    : db.prepare("SELECT COUNT(*) AS n FROM support_threads WHERE status = 'open'").get();
  res.json({ open: row ? row.n : 0 });
});

// ---- ask ----
router.post('/threads', authMiddleware, async (req, res) => {
  const db = getDb();
  try {
    const body = cleanMessage(req.body.message);
    const subject = cleanSubject(req.body.subject);
    const centerId = req.user.centerId || null;

    db.exec('BEGIN');
    let threadId;
    try {
      threadId = Number(db.prepare(`
        INSERT INTO support_threads (center_id, user_id, subject, status)
        VALUES (?, ?, ?, 'open')
      `).run(centerId, req.user.id, subject).lastInsertRowid);
      db.prepare(`
        INSERT INTO support_messages (thread_id, sender_user_id, sender_role, body) VALUES (?, ?, ?, ?)
      `).run(threadId, req.user.id, req.user.role, body);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    const thread = loadThread(db, threadId);
    const asker = {
      name: thread.user_full_name || thread.user_username,
      username: thread.user_username,
      email: thread.user_email || '',
      mobile: thread.user_mobile || '',
    };
    await logActivity('SUPPORT_QUESTION', req.user.username, {
      role: req.user.role, centerId: centerId || undefined, info: `Asked support question #${threadId}${subject ? `: ${subject}` : ''}`,
    });
    push.notifySupportQuestion(
      { threadId, subject, body, centerId, askerName: asker.name, isFollowUp: false },
      { excludeUserId: req.user.id }
    );
    sendSupportQuestionEmail({
      to: questionRecipient(centerId), thread: { id: threadId, subject }, message: body, asker,
      centerName: thread.center_name, isFollowUp: false,
    }).catch(err => console.error('[support] question email failed:', err.message));

    res.status(201).json({ thread: serializeThread(thread, { messageCount: 1 }), messages: loadMessages(db, threadId) });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message || 'Unable to send your question' });
  }
});

// ---- read one ----
router.get('/threads/:id', authMiddleware, (req, res) => {
  const db = getDb();
  const thread = loadThread(db, Number(req.params.id));
  if (!canAccess(req.user, thread)) return res.status(404).json({ message: 'Question not found' });
  const messages = loadMessages(db, thread.id);
  res.json({ thread: serializeThread(thread, { messageCount: messages.length }), messages });
});

// ---- reply (either side) ----
router.post('/threads/:id/messages', authMiddleware, async (req, res) => {
  const db = getDb();
  try {
    const thread = loadThread(db, Number(req.params.id));
    if (!canAccess(req.user, thread)) return res.status(404).json({ message: 'Question not found' });
    const body = cleanMessage(req.body.message);
    const fromOwner = thread.user_id === req.user.id;
    // An admin answering their own question still counts as the asker.
    const nextStatus = fromOwner ? 'open' : 'answered';

    db.exec('BEGIN');
    try {
      db.prepare(`
        INSERT INTO support_messages (thread_id, sender_user_id, sender_role, body) VALUES (?, ?, ?, ?)
      `).run(thread.id, req.user.id, req.user.role, body);
      db.prepare(`
        UPDATE support_threads
        SET status = ?, last_message_at = datetime('now'), updated_at = datetime('now'), closed_at = NULL, closed_by = NULL
        WHERE id = ?
      `).run(nextStatus, thread.id);
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }

    const replierName = req.user.fullName || req.user.username;
    if (fromOwner) {
      const asker = {
        name: thread.user_full_name || thread.user_username, username: thread.user_username,
        email: thread.user_email || '', mobile: thread.user_mobile || '',
      };
      push.notifySupportQuestion(
        { threadId: thread.id, subject: thread.subject, body, centerId: thread.center_id, askerName: asker.name, isFollowUp: true },
        { excludeUserId: req.user.id }
      );
      sendSupportQuestionEmail({
        to: questionRecipient(thread.center_id), thread, message: body, asker, centerName: thread.center_name, isFollowUp: true,
      }).catch(err => console.error('[support] follow-up email failed:', err.message));
    } else {
      push.notifySupportReply({
        threadId: thread.id, subject: thread.subject, body, ownerUserId: thread.user_id,
        ownerIsAdmin: isAdminRole(thread.user_role), replierName,
      });
      sendSupportReplyEmail({
        to: thread.user_email, thread, message: body, replier: replierName, centerName: thread.center_name,
      }).catch(err => console.error('[support] reply email failed:', err.message));
      await logActivity('SUPPORT_REPLY', req.user.username, {
        role: req.user.role, centerId: thread.center_id || undefined, info: `Replied on support question #${thread.id}`,
      });
    }

    const updated = loadThread(db, thread.id);
    const messages = loadMessages(db, thread.id);
    res.status(201).json({ thread: serializeThread(updated, { messageCount: messages.length }), messages });
  } catch (err) {
    res.status(err.status || 500).json({ message: err.message || 'Unable to send the reply' });
  }
});

// ---- close / reopen ----
router.put('/threads/:id/close', authMiddleware, async (req, res) => {
  const db = getDb();
  const thread = loadThread(db, Number(req.params.id));
  if (!canAccess(req.user, thread)) return res.status(404).json({ message: 'Question not found' });
  db.prepare(`
    UPDATE support_threads SET status = 'closed', closed_at = datetime('now'), closed_by = ?, updated_at = datetime('now') WHERE id = ?
  `).run(req.user.username, thread.id);
  const updated = loadThread(db, thread.id);
  res.json({ thread: serializeThread(updated), messages: loadMessages(db, thread.id) });
});

router.put('/threads/:id/reopen', authMiddleware, async (req, res) => {
  const db = getDb();
  const thread = loadThread(db, Number(req.params.id));
  if (!canAccess(req.user, thread)) return res.status(404).json({ message: 'Question not found' });
  const status = thread.user_id === req.user.id ? 'open' : 'answered';
  db.prepare(`
    UPDATE support_threads SET status = ?, closed_at = NULL, closed_by = NULL, updated_at = datetime('now') WHERE id = ?
  `).run(status, thread.id);
  const updated = loadThread(db, thread.id);
  res.json({ thread: serializeThread(updated), messages: loadMessages(db, thread.id) });
});

module.exports = router;
