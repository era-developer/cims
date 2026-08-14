const crypto = require('crypto');
const { getDb } = require('./db');
const { requireCenter } = require('./centers');

async function saveWhatsappMessage(message) {
  const centerId = String(message.centerId || '').trim();
  if (!centerId) return message;
  const center = requireCenter(centerId);
  const messageId = message.messageId || crypto.randomUUID();
  getDb().prepare(`
    INSERT INTO whatsapp_messages
      (message_id, center_id, center_name, ts, direction, from_number, to_number, profile_name, body, channel, order_id, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    messageId, center.id, center.name,
    message.ts ? new Date(message.ts).toISOString() : new Date().toISOString(),
    message.direction || 'inbound', message.from || '', message.to || '', message.profileName || '',
    message.body || '', message.channel || 'whatsapp', message.orderId || '', message.status || '',
  );
  return { ...message, messageId, centerId: center.id, centerName: center.name };
}

function getWhatsappMessages(centerId) {
  const center = requireCenter(centerId);
  return getDb().prepare(`
    SELECT message_id AS messageId, center_id AS centerId, center_name AS centerName, ts, direction,
           from_number AS "from", to_number AS "to", profile_name AS profileName, body, channel,
           order_id AS orderId, status
    FROM whatsapp_messages WHERE center_id = ? ORDER BY ts DESC
  `).all(center.id);
}

module.exports = { saveWhatsappMessage, getWhatsappMessages };
