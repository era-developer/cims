// Shared bits for the bell dropdown and the Notifications page.

export function timeAgo(iso) {
  if (!iso) return '';
  // SQLite's datetime('now') has no zone marker; it is UTC.
  const when = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso.replace(' ', 'T') + 'Z');
  const diff = Math.max(0, Date.now() - when.getTime());
  const m = Math.round(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  if (d < 7) return `${d} day${d === 1 ? '' : 's'} ago`;
  return when.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: d > 300 ? 'numeric' : undefined });
}

export function formatWhen(iso) {
  if (!iso) return '';
  const when = new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(iso) ? iso : iso.replace(' ', 'T') + 'Z');
  return when.toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

const ICONS = {
  order_placed: '🧾',
  order_approved: '✅',
  order_rejected: '❌',
  order_partial_return: '↩️',
  order_returned: '📦',
  return_requested: '↩️',
  return_reminder: '⏰',
  new_order: '🛒',
  new_registration: '🧑‍🎓',
  account_approved: '🎉',
  transfer_request: '🔁',
  'transfer_return-request': '🔁',
  transfer_approved: '🚚',
  transfer_returned: '📦',
};

export function kindIcon(kind) {
  return ICONS[kind] || '🔔';
}

export const KIND_LABELS = {
  order_placed: 'Order placed',
  order_approved: 'Approved',
  order_rejected: 'Rejected',
  order_partial_return: 'Part return',
  order_returned: 'Returned',
  return_requested: 'Return requested',
  return_reminder: 'Reminder',
  new_order: 'New order',
  new_registration: 'Registration',
  account_approved: 'Account',
  transfer_request: 'Transfer request',
  'transfer_return-request': 'Transfer return',
  transfer_approved: 'Transfer approved',
  transfer_returned: 'Transfer returned',
};
