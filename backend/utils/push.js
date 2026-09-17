const webpush = require('web-push');
const { getDb } = require('./db');
const { getOrgShortName } = require('./settings');
const notifications = require('./notifications');

// Web Push (browser notifications) for students and admins. Sits next to the
// e-mail notices: every place that sends a lifecycle e-mail also calls one of
// the helpers here, so a student who enabled notifications on their phone
// hears about an approval the moment the admin clicks it.
//
// Keys come from backend/.env (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY /
// VAPID_SUBJECT). Without them the feature is simply off: subscribe requests
// are refused with a clear message and every send is a no-op.

let configured = null;

function isConfigured() {
  if (configured !== null) return configured;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) {
    configured = false;
    console.warn('[push] VAPID keys missing -- browser notifications disabled');
    return configured;
  }
  try {
    webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@example.org', pub, priv);
    configured = true;
  } catch (err) {
    console.error('[push] invalid VAPID configuration:', err.message);
    configured = false;
  }
  return configured;
}

function getPublicKey() {
  return isConfigured() ? process.env.VAPID_PUBLIC_KEY : null;
}

// ---- subscription storage -------------------------------------------------

function saveSubscription(userId, subscription, userAgent) {
  const endpoint = String(subscription?.endpoint || '');
  const p256dh = subscription?.keys?.p256dh;
  const auth = subscription?.keys?.auth;
  if (!endpoint.startsWith('https://') || !p256dh || !auth) {
    throw new Error('Invalid push subscription');
  }
  const db = getDb();
  db.prepare(`
    INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET
      user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
      user_agent = excluded.user_agent
  `).run(userId, endpoint, p256dh, auth, userAgent ? String(userAgent).slice(0, 300) : null);
}

function removeSubscription(userId, endpoint) {
  const db = getDb();
  return db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').run(String(endpoint || ''), userId).changes;
}

function countForUser(userId) {
  return getDb().prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?').get(userId).n;
}

function hasEndpoint(userId, endpoint) {
  return !!getDb().prepare('SELECT 1 FROM push_subscriptions WHERE user_id = ? AND endpoint = ?').get(userId, String(endpoint || ''));
}

// ---- sending --------------------------------------------------------------

// Deep links stay relative: the service worker that shows the notification
// runs on the portal's own origin, so "/my-orders?q=X" opens directly there
// without a hop through the short link. If the person is signed out, the app
// bounces to Login with ?next= and lands on the page after sign-in.
function absoluteUrl(url) {
  if (!url) return '/';
  if (/^https?:\/\//i.test(url)) return url;
  return url.startsWith('/') ? url : `/${url}`;
}

function buildPayload({ title, body, url, tag }) {
  return JSON.stringify({
    title: title || getOrgShortName(),
    body: body || '',
    url: absoluteUrl(url),
    tag: tag || undefined,
    icon: '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
  });
}

async function sendToSubscriptionRows(rows, payload) {
  if (!isConfigured() || !rows.length) return { sent: 0, failed: 0, removed: 0 };
  const db = getDb();
  const body = buildPayload(payload);
  let sent = 0, failed = 0, removed = 0;
  await Promise.all(rows.map(async row => {
    const sub = { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } };
    try {
      await webpush.sendNotification(sub, body, { TTL: 60 * 60 * 24 });
      db.prepare('UPDATE push_subscriptions SET last_used_at = ? WHERE id = ?').run(new Date().toISOString(), row.id);
      sent += 1;
    } catch (err) {
      failed += 1;
      // 404/410: the browser dropped the subscription (user revoked, app
      // uninstalled). Forget it so we stop trying.
      if (err.statusCode === 404 || err.statusCode === 410) {
        db.prepare('DELETE FROM push_subscriptions WHERE id = ?').run(row.id);
        removed += 1;
      } else {
        console.error(`[push] send failed (${err.statusCode || 'n/a'}):`, err.body || err.message);
      }
    }
  }));
  return { sent, failed, removed };
}

// Notify one user on every browser they enabled.
async function sendToUser(userId, payload) {
  if (!userId || !isConfigured()) return { sent: 0, failed: 0, removed: 0 };
  const rows = getDb().prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(userId);
  return sendToSubscriptionRows(rows, payload);
}
// ---- delivery: in-app record + push ---------------------------------------
// Every event is written to the notification centre for each recipient (so
// the bell shows it even with push off), then pushed to whichever of their
// devices opted in.

async function deliver(userIds, { kind, title, body, url, ref }) {
  const ids = [...new Set((userIds || []).filter(Boolean))];
  if (!ids.length) return { recorded: 0, sent: 0, failed: 0, removed: 0 };
  let recorded = 0;
  try {
    recorded = notifications.recordMany(ids, { kind, title, body, url, ref });
  } catch (err) {
    console.error('[notify] could not record in-app notification:', err.message);
  }
  const totals = { recorded, sent: 0, failed: 0, removed: 0 };
  for (const id of ids) {
    const r = await sendToUser(id, { title, body, url, tag: ref ? `${kind}-${ref}` : kind });
    totals.sent += r.sent; totals.failed += r.failed; totals.removed += r.removed;
  }
  return totals;
}

// ---- the lifecycle messages -------------------------------------------------
// Short, phone-sized copy. The order id is the one thing the student already
// knows, so it leads.

// Both order pages already filter by ?q=, so a tap lands on that one order.
function orderUrl(orderId, isAdmin) {
  return `${isAdmin ? '/admin/orders' : '/my-orders'}?q=${encodeURIComponent(orderId)}`;
}

// The order API shape deliberately does not carry the student's user id, so
// look it up from the order id when it is time to notify them.
function studentUserIdForOrder(order) {
  if (order?.studentUserId) return order.studentUserId;
  if (!order?.orderId) return null;
  const row = getDb().prepare(`
    SELECT s.user_id AS userId FROM issue_records ir
    JOIN students s ON s.id = ir.student_id WHERE ir.order_id = ?
  `).get(order.orderId);
  return row?.userId || null;
}

function summarizeItems(items = [], max = 2) {
  const names = (items || []).map(i => `${i.qty} × ${i.name}`);
  if (!names.length) return '';
  if (names.length <= max) return names.join(', ');
  return `${names.slice(0, max).join(', ')} +${names.length - max} more`;
}

const STATUS_COPY = {
  'Approved': o => ({ kind: 'order_approved', title: `Order ${o.orderId} approved`, body: `Collect ${summarizeItems(o.items)} from the lab.${o.expectedReturnDate ? ` Return by ${o.expectedReturnDate}.` : ''}` }),
  'Rejected': o => ({ kind: 'order_rejected', title: `Order ${o.orderId} rejected`, body: o.adminRemarks ? `Reason: ${o.adminRemarks}` : 'Open the order for details.' }),
  'Partially Returned': o => ({ kind: 'order_partial_return', title: `Order ${o.orderId}: part return recorded`, body: o.outstandingItems?.length ? `Still with you: ${summarizeItems(o.outstandingItems)}` : 'Some items are still with you.' }),
  'Returned': o => ({ kind: 'order_returned', title: `Order ${o.orderId} closed`, body: 'All components returned. Thank you!' }),
};

// Student-facing status change. Fire-and-forget; never throws.
async function notifyStudentOrderStatus(order, status) {
  try {
    const make = STATUS_COPY[status];
    const userId = make ? studentUserIdForOrder(order) : null;
    if (!userId) return;
    await deliver([userId], { ...make(order), url: orderUrl(order.orderId, false), ref: order.orderId });
  } catch (err) {
    console.error('[push] student status notice failed:', err.message);
  }
}

async function notifyStudentOrderPlaced(order) {
  try {
    const userId = studentUserIdForOrder(order);
    if (!userId) return;
    await deliver([userId], {
      kind: 'order_placed',
      title: `Order ${order.orderId} received`,
      body: `${summarizeItems(order.items)} requested. You will be notified when it is reviewed.`,
      url: orderUrl(order.orderId, false), ref: order.orderId,
    });
  } catch (err) {
    console.error('[push] order placed notice failed:', err.message);
  }
}

async function notifyStudentReturnReminder(order) {
  try {
    const userId = studentUserIdForOrder(order);
    if (!userId) return { recorded: 0, sent: 0 };
    return await deliver([userId], {
      kind: 'return_reminder',
      title: `Return due tomorrow: ${order.orderId}`,
      body: `${summarizeItems(order.outstandingItems?.length ? order.outstandingItems : order.items) || 'Your components'} ${(order.outstandingItems?.length || order.items?.length) ? 'is' : 'are'} due back on ${order.expectedReturnDate}. Please return to the lab.`,
      url: orderUrl(order.orderId, false), ref: order.orderId,
    });
  } catch (err) {
    console.error('[push] return reminder notice failed:', err.message);
    return { recorded: 0, sent: 0 };
  }
}

async function notifyAdminsNewOrder(order, { excludeUserId } = {}) {
  try {
    await deliver(notifications.centerAdminIds(order.centerId, { excludeUserId }), {
      kind: 'new_order',
      title: `New order ${order.orderId}`,
      body: `${order.studentName || 'A student'} requested ${summarizeItems(order.items)}.`,
      url: orderUrl(order.orderId, true), ref: order.orderId,
    });
  } catch (err) {
    console.error('[push] admin new-order notice failed:', err.message);
  }
}

async function notifyAdminsReturnRequested(order, { excludeUserId } = {}) {
  try {
    await deliver(notifications.centerAdminIds(order.centerId, { excludeUserId }), {
      kind: 'return_requested',
      title: `Return requested: ${order.orderId}`,
      body: `${order.studentName || 'A student'} is bringing back ${summarizeItems(order.outstandingItems?.length ? order.outstandingItems : order.items)}.`,
      url: orderUrl(order.orderId, true), ref: order.orderId,
    });
  } catch (err) {
    console.error('[push] admin return-request notice failed:', err.message);
  }
}

async function notifyAdminsNewRegistration({ centerId, fullName, username }) {
  try {
    await deliver(notifications.centerAdminIds(centerId), {
      kind: 'new_registration',
      title: 'New student registration',
      body: `${fullName || username} is waiting for approval.`,
      url: '/admin/users', ref: username,
    });
  } catch (err) {
    console.error('[push] admin registration notice failed:', err.message);
  }
}

// The student's first entry in the bell: waiting for them at first sign-in.
async function notifyAccountApproved(user) {
  try {
    if (!user?.id) return;
    await deliver([user.id], {
      kind: 'account_approved',
      title: 'Your account is approved',
      body: 'Welcome! You can now browse components and place orders.',
      url: '/dashboard', ref: user.username,
    });
  } catch (err) {
    console.error('[push] account approved notice failed:', err.message);
  }
}

module.exports = {
  isConfigured, getPublicKey,
  saveSubscription, removeSubscription, countForUser, hasEndpoint,
  sendToUser, deliver,
  notifyStudentOrderStatus, notifyStudentOrderPlaced, notifyStudentReturnReminder,
  notifyAdminsNewOrder, notifyAdminsReturnRequested, notifyAdminsNewRegistration, notifyAccountApproved,
};
