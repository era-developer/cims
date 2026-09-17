const express = require('express');
const { authMiddleware } = require('../middleware/auth');
const push = require('../utils/push');
const { getOrgShortName } = require('../utils/settings');

const router = express.Router();

// Anyone signed in can ask for the key; it is public by design (it is what
// the browser hands to the push service to pin the subscription to us).
router.get('/public-key', authMiddleware, (req, res) => {
  const key = push.getPublicKey();
  if (!key) return res.status(503).json({ message: 'Browser notifications are not configured on this server' });
  res.json({ publicKey: key });
});

// Where this browser stands: whether its endpoint is registered for the
// signed-in user, and how many browsers the user has enabled in total.
router.get('/status', authMiddleware, (req, res) => {
  const endpoint = String(req.query.endpoint || '');
  res.json({
    configured: push.isConfigured(),
    subscribed: endpoint ? push.hasEndpoint(req.user.id, endpoint) : false,
    devices: push.countForUser(req.user.id),
  });
});

router.post('/subscribe', authMiddleware, (req, res) => {
  if (!push.isConfigured()) return res.status(503).json({ message: 'Browser notifications are not configured on this server' });
  try {
    push.saveSubscription(req.user.id, req.body?.subscription || req.body, req.headers['user-agent']);
    res.json({ message: 'Notifications enabled on this device', devices: push.countForUser(req.user.id) });
  } catch (err) {
    res.status(400).json({ message: err.message || 'Could not save subscription' });
  }
});

router.delete('/subscribe', authMiddleware, (req, res) => {
  const removed = push.removeSubscription(req.user.id, req.body?.endpoint);
  res.json({ message: removed ? 'Notifications turned off on this device' : 'This device was not subscribed', devices: push.countForUser(req.user.id) });
});

// "Send me a test" so the user can see what a notification looks like right
// after enabling, without waiting for an admin to do something.
router.post('/test', authMiddleware, async (req, res) => {
  const result = await push.sendToUser(req.user.id, {
    title: `${getOrgShortName()} notifications are on`,
    body: req.user.role === 'student'
      ? 'You will hear here when your orders are approved, rejected or due back.'
      : 'You will hear here about new orders, return requests and registrations.',
    url: req.user.role === 'student' ? '/orders' : '/admin/orders',
    tag: 'test',
  });
  if (!result.sent) return res.status(400).json({ message: 'No enabled device received the test. Enable notifications first.', ...result });
  res.json({ message: `Test sent to ${result.sent} device${result.sent === 1 ? '' : 's'}`, ...result });
});

module.exports = router;
