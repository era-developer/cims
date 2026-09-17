const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const notifications = require('../utils/notifications');

const router = express.Router();

// GET /api/notifications?limit=30&before=<id>&unread=1
router.get('/', authMiddleware, (req, res) => {
  const page = notifications.list(req.user.id, {
    limit: req.query.limit,
    before: req.query.before ? Number(req.query.before) : null,
    unreadOnly: req.query.unread === '1',
  });
  res.json({ ...page, unread: notifications.unreadCount(req.user.id) });
});

router.get('/unread-count', authMiddleware, (req, res) => {
  res.json({ unread: notifications.unreadCount(req.user.id) });
});

router.put('/read-all', authMiddleware, (req, res) => {
  const changed = notifications.markAllRead(req.user.id);
  res.json({ message: changed ? `${changed} marked as read` : 'Nothing to mark', unread: 0 });
});

router.put('/:id/read', authMiddleware, (req, res) => {
  notifications.markRead(req.user.id, req.params.id);
  res.json({ unread: notifications.unreadCount(req.user.id) });
});

module.exports = router;
