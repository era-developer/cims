require('dotenv').config();

const { saveWhatsappMessage } = require('./whatsappDb');
const { readCenterSpecificEnv } = require('./email');

function readEnv(name) {
  const value = process.env[name];
  if (value === undefined || value === null) return '';
  return String(value).trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}

function normalizePhone(value) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  const digits = trimmed.replace(/[^\d+]/g, '');
  if (!digits) return '';
  return digits.startsWith('+') ? digits : `+${digits}`;
}

function getAdminWhatsAppRecipient(centerId) {
  // Try to get center-specific WhatsApp number first
  const centerWhatsapp = readCenterSpecificEnv(centerId, 'WHATSAPP_ADMIN_TO');
  if (centerWhatsapp) {
    return normalizePhone(centerWhatsapp);
  }
  // Fallback to the general admin number if center-specific is not found
  return normalizePhone(readEnv('N8N_WHATSAPP_ADMIN_TO'));
}

function getWhatsAppConfig() {
  const outboundWebhook = readEnv('N8N_WHATSAPP_OUTBOUND_WEBHOOK');
  const sharedSecret = readEnv('N8N_WHATSAPP_SHARED_SECRET');
  const adminTo = normalizePhone(readEnv('N8N_WHATSAPP_ADMIN_TO'));
  const enabled = ['1', 'true', 'yes', 'on'].includes(readEnv('N8N_WHATSAPP_ENABLED').toLowerCase());

  return {
    outboundWebhook,
    sharedSecret,
    adminTo,
    enabled,
    configured: Boolean(enabled && outboundWebhook),
  };
}

function getStudentRecipient(order) {
  const raw = order?.studentDetails?.mobile || order?.mobile || '';
  return normalizePhone(raw);
}

function extractOrderId(text = '') {
  const match = String(text || '').match(/CIMS-[A-Z0-9]+/i);
  return match ? match[0].toUpperCase() : '';
}

function buildItemSummary(items = []) {
  const safeItems = Array.isArray(items) ? items : [];
  const itemSummary = safeItems.slice(0, 5).map(item => `${item.name} x${item.qty}`).join(', ');
  return {
    itemSummary,
    moreCount: Math.max(0, safeItems.length - 5),
  };
}

function buildOrderEvent(order) {
  const { itemSummary, moreCount } = buildItemSummary(order.items);
  return {
    eventType: 'order_created',
    orderId: order.orderId,
    centerId: order.centerId || '',
    centerName: order.centerName || '',
    status: order.status || 'Pending',
    student: {
      username: order.username || '',
      name: order.studentDetails?.studentName || '',
      email: order.studentEmail || '',
      mobile: normalizePhone(order.studentDetails?.mobile || order.mobile || ''),
      altMobile: normalizePhone(order.studentDetails?.altMobile || ''),
      college: order.studentDetails?.college || '',
      department: order.studentDetails?.department || '',
      degree: order.studentDetails?.degree || '',
      graduationYear: order.studentDetails?.graduationYear || '',
    },
    project: {
      courseName: order.studentDetails?.courseName || '',
      projectName: order.studentDetails?.projectName || '',
      teamName: order.studentDetails?.teamName || '',
      facultyGuide: order.studentDetails?.facultyGuide || '',
      purpose: order.studentDetails?.purpose || '',
    },
    items: Array.isArray(order.items) ? order.items : [],
    summary: {
      itemSummary,
      moreCount,
    },
    recipients: {
      admin: getAdminWhatsAppRecipient(order.centerId), // Use the new function
      student: getStudentRecipient(order),
    },
    source: 'cims',
  };
}

function buildStatusEvent(order, status, remarks) {
  const { itemSummary, moreCount } = buildItemSummary(order.items);
  return {
    eventType: 'order_status_changed',
    orderId: order.orderId,
    centerId: order.centerId || '',
    centerName: order.centerName || '',
    status,
    remarks: remarks || '',
    student: {
      username: order.username || '',
      name: order.studentDetails?.studentName || order.studentName || '',
      email: order.studentEmail || '',
      mobile: normalizePhone(order.studentDetails?.mobile || order.mobile || ''),
    },
    project: {
      courseName: order.studentDetails?.courseName || order.courseName || '',
      projectName: order.studentDetails?.projectName || order.projectName || '',
      teamName: order.studentDetails?.teamName || order.teamName || '',
    },
    items: Array.isArray(order.items) ? order.items : [],
    summary: {
      itemSummary,
      moreCount,
    },
    recipients: {
      admin: getAdminWhatsAppRecipient(order.centerId), // Use the new function
      student: getStudentRecipient(order),
    },
    source: 'cims',
  };
}

async function verifyWhatsAppConnection() {
  const config = getWhatsAppConfig();
  if (!config.enabled) {
    return {
      ok: false,
      configured: false,
      message: 'WhatsApp is disabled. Set N8N_WHATSAPP_ENABLED=true to enable n8n webhook delivery.',
    };
  }

  if (!config.outboundWebhook) {
    return {
      ok: false,
      configured: false,
      message: 'WhatsApp not configured. Set N8N_WHATSAPP_OUTBOUND_WEBHOOK.',
    };
  }

  return {
    ok: true,
    configured: true,
    message: `WhatsApp ready via n8n webhook ${config.outboundWebhook}.`,
  };
}

async function postToN8n(payload) {
  const config = getWhatsAppConfig();
  if (!config.configured) {
    return { ok: false, skipped: true, message: 'WhatsApp n8n webhook not configured.' };
  }

  try {
    const response = await fetch(config.outboundWebhook, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(config.sharedSecret ? { 'x-cims-webhook-secret': config.sharedSecret } : {}),
      },
      body: JSON.stringify(payload),
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(`n8n webhook failed with ${response.status}: ${text}`);
    }

    return { ok: true, status: response.status, responseText: text };
  } catch (err) {
    console.error('[WHATSAPP ERROR]', err.message);
    return { ok: false, error: err.message };
  }
}

async function logOutboundWhatsapp(payload, result) {
  const recipients = payload.recipients || {};
  const targets = [recipients.admin, recipients.student].filter(Boolean).join(', ');
  await saveWhatsappMessage({
    messageId: '',
    centerId: payload.centerId || '',
    ts: new Date(),
    direction: 'outbound',
    from: 'cims-via-n8n',
    to: targets,
    profileName: payload.student?.name || '',
    body: JSON.stringify(payload),
    channel: 'whatsapp-n8n',
    orderId: payload.orderId || '',
    status: result.ok ? 'queued-via-n8n' : `failed: ${result.error || result.message || 'unknown'}`,
  });
}

async function sendOrderWhatsAppNotifications(order) {
  const configStatus = await verifyWhatsAppConnection();
  if (!configStatus.ok) return configStatus;

  const payload = buildOrderEvent(order);
  const result = await postToN8n(payload);
  await logOutboundWhatsapp(payload, result);
  return result;
}

async function sendStatusWhatsAppNotifications(order, status, remarks) {
  const configStatus = await verifyWhatsAppConnection();
  if (!configStatus.ok) return configStatus;

  const payload = buildStatusEvent(order, status, remarks);
  const result = await postToN8n(payload);
  await logOutboundWhatsapp(payload, result);
  return result;
}

function isAuthorizedInboundRequest(req) {
  const config = getWhatsAppConfig();
  if (!config.sharedSecret) return true;
  const supplied = String(req.headers['x-cims-webhook-secret'] || req.query.secret || '').trim();
  return supplied && supplied === config.sharedSecret;
}

async function recordIncomingWhatsAppMessage(payload) {
  const body = String(payload.body || payload.message || payload.text || '').trim();
  const from = normalizePhone(payload.from || payload.sender || payload.mobile || '');
  const to = normalizePhone(payload.to || payload.recipient || '');
  const profileName = String(payload.profileName || payload.name || '').trim();
  const orderId = extractOrderId(body || payload.orderId || '');
  const centerId = String(payload.centerId || '').trim();

  await saveWhatsappMessage({
    messageId: String(payload.messageId || payload.id || ''),
    centerId,
    ts: payload.ts || payload.timestamp || new Date(),
    direction: 'inbound',
    from,
    to,
    profileName,
    body,
    channel: 'whatsapp-n8n',
    orderId,
    status: String(payload.status || 'received'),
  });

  return {
    ok: true,
    centerId,
    from,
    to,
    profileName,
    orderId,
    body,
  };
}

module.exports = {
  extractOrderId,
  getWhatsAppConfig,
  getAdminWhatsAppRecipient, // Export the new function
  isAuthorizedInboundRequest,
  recordIncomingWhatsAppMessage,
  sendOrderWhatsAppNotifications,
  sendStatusWhatsAppNotifications,
  verifyWhatsAppConnection,
};
