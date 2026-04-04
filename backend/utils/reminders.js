const { getOrders, updateOrderStatus } = require('./excel');
const { sendReturnReminder } = require('./email');

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
  if (!order.studentEmail || !order.expectedReturnDate || order.reminderSentAt) return false;

  const expected = new Date(order.expectedReturnDate);
  if (Number.isNaN(expected.getTime())) return false;

  return diffInDays(now, expected) === 1;
}

async function processReturnReminders() {
  const orders = await getOrders();
  const candidates = orders.filter(order => shouldSendReminder(order));
  let sentCount = 0;

  for (const order of candidates) {
    try {
      const result = await sendReturnReminder(order);
      if (!result?.ok) continue;

      await updateOrderStatus(order.orderId, order.status, order.adminRemarks, {
        reminderSentAt: new Date().toISOString(),
      });
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
