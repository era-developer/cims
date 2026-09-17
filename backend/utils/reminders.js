const { sendReturnReminder } = require('./email');
const { notifyStudentReturnReminder } = require('./push');
const { listCenters } = require('./centers');

function startOfDay(date) {
  const normalized = new Date(date);
  normalized.setHours(0, 0, 0, 0);
  return normalized;
}

function diffInDays(fromDate, toDate) {
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((startOfDay(toDate) - startOfDay(fromDate)) / msPerDay);
}

function shouldSendReminder(order, now = new Date()) {
  if (order.status !== 'Approved') return false;
  if (!order.expectedReturnDate || order.reminderSentAt) return false;

  const expected = new Date(order.expectedReturnDate);
  if (Number.isNaN(expected.getTime())) return false;

  return diffInDays(now, expected) === 1;
}

async function processReturnReminders() {
  // Lazy require: orders.js requires db.js at module load, and this file is
  // itself required by server.js before the DB necessarily needs opening --
  // avoids any import-order surprises.
  const { getOrdersForCenter, markReminderSent } = require('../routes/orders');

  const orders = listCenters().flatMap(center => getOrdersForCenter(center.id));
  const candidates = orders.filter(order => shouldSendReminder(order));
  let sentCount = 0;

  for (const order of candidates) {
    try {
      // E-mail and the bell/push are independent channels: a bounced e-mail
      // must not stop the in-app reminder, and vice versa. The order is
      // marked reminded once either channel reached the student, so nobody
      // is nagged hourly.
      const email = await sendReturnReminder(order, order.centerId).catch(err => ({ ok: false, message: err.message }));
      const inApp = await notifyStudentReturnReminder(order);
      if (!email?.ok && !inApp?.recorded) continue;

      markReminderSent(order.orderId, new Date().toISOString());
      sentCount += 1;
    } catch (err) {
      console.error(`[REMINDER ERROR] ${order.orderId}: ${err.message}`);
    }
  }

  return { checked: orders.length, eligible: candidates.length, sent: sentCount };
}

module.exports = {
  processReturnReminders,
};
