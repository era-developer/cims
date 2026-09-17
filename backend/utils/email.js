const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Same source file the order/invoice PDFs embed (backend/assets/logo.png).
// Referenced via a cid: attachment rather than a hosted URL -- most mail
// clients block remote images by default until the user clicks "show
// images", so an inline attachment is the only way the logo reliably shows
// up without an extra click.
const LOGO_PATH = path.join(__dirname, '..', 'assets', 'logo.png');
const LOGO_EXISTS = fs.existsSync(LOGO_PATH);
const LOGO_CID = 'cimslogo';

function readEnv(name) {
  const value = process.env[name];
  if (value === undefined || value === null) return '';
  return String(value).trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}

function parsePort(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isTruthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function getSmtpConfig() {
  const host = readEnv('SMTP_HOST') || 'smtp.gmail.com';
  const port = parsePort(readEnv('SMTP_PORT'), 587);
  const secure = isTruthy(readEnv('SMTP_SECURE')) || port === 465;
  const user = readEnv('SMTP_USER');
  const pass = readEnv('SMTP_PASS');

  return {
    host,
    port,
    secure,
    user,
    pass,
    configured: Boolean(user && pass),
  };
}

function createTransporter() {
  const config = getSmtpConfig();
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass,
    },
  });
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Spam filters weight the presence of a text/plain alternative heavily --
// an HTML-only email is a well-known trigger. Since every email here is
// built from our own controlled markup (never arbitrary user HTML), a
// straightforward tag-strip gives a faithful, readable plain-text part
// without hand-writing a parallel text template for every message type.
function htmlToText(html) {
  return String(html || '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<(br|\/tr|\/p|\/div|\/h[1-6]|\/li)\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<\/table>/gi, '\n')
    .replace(/<td[^>]*>/gi, ' | ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n').map(line => line.trim()).join('\n')
    .trim();
}

function readCenterSpecificEnv(centerId, keySuffix) {
  if (!centerId) return '';
  const key = `${centerId.toUpperCase().replace(/-/g, '_')}_${keySuffix}`;
  return readEnv(key);
}

// Resolution order: the center's own notification_email (editable by a super
// admin in Settings -> Centers), then the org-wide order email, then the
// legacy {CENTER_ID}_EMAIL / CENTER_EMAIL / SMTP_USER env vars. The env tail
// is what keeps an existing .env-configured deployment working with no
// database rows at all.
//
// Required lazily: utils/settings.js and utils/centers.js both open the
// database, and email.js is required at server boot before the DB is needed.
function getAdminRecipient(centerId) {
  try {
    const { getCenterById } = require('./centers');
    const settings = require('./settings');
    const center = centerId ? getCenterById(centerId) : null;
    const resolved = settings.getOrderEmail(centerId, center);
    if (resolved) return resolved;
  } catch (error) {
    console.warn('[email] settings lookup failed, falling back to env:', error.message);
  }

  const centerEmail = readCenterSpecificEnv(centerId, 'EMAIL');
  if (centerEmail) {
    return centerEmail;
  }

  return readEnv('CENTER_EMAIL') || readEnv('SMTP_USER') || '';
}

function getSiteUrl() {
  try {
    const url = require('./settings').getSiteUrl();
    if (url) return url;
  } catch {
    // Fall through to env below.
  }
  return readEnv('SITE_URL') || '';
}

// The `from` display name on every outgoing email. Was the hardcoded string
// "Comedkares Innovation Hub - CIMS" in eight places in this file.
function getSenderName() {
  try {
    const name = require('./settings').getEmailSenderName();
    if (name) return name;
  } catch {
    // Fall through to env below.
  }
  return readEnv('EMAIL_SENDER_NAME') || 'Kalam Pragati - KIMS';
}

function getOrgName() {
  try {
    const name = require('./settings').getOrgName();
    if (name) return name;
  } catch {
    // Fall through to env below.
  }
  return readEnv('ORG_NAME') || 'Kalam Pragati';
}

function getOrgShortName() {
  try {
    const name = require('./settings').getOrgShortName();
    if (name) return name;
  } catch {
    // Fall through to env below.
  }
  return readEnv('ORG_SHORT_NAME') || 'KIMS';
}

function buildReplyTo(primary, fallback) {
  return String(primary || fallback || '').trim();
}

function getStudentDetails(order) {
  return order.studentDetails || {
    studentName: order.studentName,
    mobile: order.mobile,
    college: order.college,
    department: order.department,
    courseName: order.courseName,
    programName: order.programName,
    projectName: order.projectName,
    teamName: order.teamName,
    facultyGuide: order.facultyGuide,
    expectedReturnDate: order.expectedReturnDate,
    purpose: order.purpose,
  };
}

function formatDateOnly(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function getItems(order) {
  if (Array.isArray(order.items) && order.items.length) return order.items;
  try {
    const parsed = JSON.parse(order.itemsJson || '[]');
    if (Array.isArray(parsed) && parsed.length) {
      return parsed;
    }
  } catch {
  }

  const fallback = String(order.components || '').trim();
  if (!fallback) return [];
  return fallback
    .split(',')
    .map(entry => entry.trim())
    .filter(Boolean)
    .map((entry, index) => {
      const match = entry.match(/^(.*)\(x(\d+)\)$/i);
      return {
        id: `fallback-${index + 1}`,
        name: match ? match[1].trim() : entry,
        qty: match ? Number(match[2]) || 1 : 1,
        unit: 'pcs',
      };
    });
}

function componentSummaryText(items) {
  if (!Array.isArray(items) || !items.length) {
    return 'Component details are unavailable for this order.';
  }
  return items
    .map(item => `${item.name} x${item.qty} ${item.unit || 'pcs'}`)
    .join(', ');
}

function componentTable(items) {
  if (!items.length) {
    return '<p style="color:#666;font-size:13px;">Component details are unavailable for this order.</p>';
  }

  const rows = items.map(item => `
    <tr>
      <td style="padding:8px 12px;border:1px solid #dbe3f0;background:#ffffff;color:#16213e;">${escapeHtml(item.name)}</td>
      <td style="padding:8px 12px;border:1px solid #dbe3f0;text-align:center;background:#ffffff;color:#16213e;">${escapeHtml(item.qty)}</td>
      <td style="padding:8px 12px;border:1px solid #dbe3f0;text-align:center;background:#ffffff;color:#16213e;">${escapeHtml(item.unit || 'pcs')}</td>
    </tr>
  `).join('');

  return `
    <table style="border-collapse:collapse;width:100%;margin-top:12px;">
      <thead>
        <tr style="background:#1a237e;color:#fff;">
          <th style="padding:8px 12px;border:1px solid #dbe3f0;text-align:left;">Component</th>
          <th style="padding:8px 12px;border:1px solid #dbe3f0;">Qty</th>
          <th style="padding:8px 12px;border:1px solid #dbe3f0;">Unit</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function componentBulletList(items) {
  if (!items.length) return '';
  const rows = items
    .map(item => `<li style="margin:0 0 6px;color:#16213e;"><strong>${escapeHtml(item.name)}</strong> - ${escapeHtml(item.qty)} ${escapeHtml(item.unit || 'pcs')}</li>`)
    .join('');
  return `<ul style="margin:8px 0 12px 18px;padding:0;">${rows}</ul>`;
}

function returnSummaryTable(summary = []) {
  if (!Array.isArray(summary) || !summary.length) return '';

  const rows = summary.map(item => `
    <tr>
      <td style="padding:8px 12px;border:1px solid #dbe3f0;">${escapeHtml(item.name)}</td>
      <td style="padding:8px 12px;border:1px solid #dbe3f0;text-align:center;">${escapeHtml(item.orderedQty)}</td>
      <td style="padding:8px 12px;border:1px solid #dbe3f0;text-align:center;">${escapeHtml(item.returnedQty)}</td>
      <td style="padding:8px 12px;border:1px solid #dbe3f0;text-align:center;">${escapeHtml(item.damagedQty)}</td>
      <td style="padding:8px 12px;border:1px solid #dbe3f0;text-align:center;">${escapeHtml(item.pendingQty)}</td>
    </tr>
  `).join('');

  return `
    <table style="border-collapse:collapse;width:100%;margin-top:12px;">
      <thead>
        <tr style="background:#17355f;color:#fff;">
          <th style="padding:8px 12px;border:1px solid #dbe3f0;text-align:left;">Component</th>
          <th style="padding:8px 12px;border:1px solid #dbe3f0;">Ordered</th>
          <th style="padding:8px 12px;border:1px solid #dbe3f0;">Returned</th>
          <th style="padding:8px 12px;border:1px solid #dbe3f0;">Damaged/Consumed</th>
          <th style="padding:8px 12px;border:1px solid #dbe3f0;">Pending</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

function noteList(items = []) {
  if (!items.length) return '';
  const rows = items
    .map(item => `<li style="margin:0 0 6px;color:#334155;">${item}</li>`)
    .join('');
  return `<ul style="margin:8px 0 0 18px;padding:0;">${rows}</ul>`;
}

function buildPolicyNotes(status, audience = 'student') {
  const isAdmin = audience === 'admin';

  if (status === 'Pending') {
    return {
      title: 'Notes and policy',
      html: noteList([
        'Components are only requested at this stage. Issue them only after approval and stock verification.',
        isAdmin
          ? 'Please verify quantities, project purpose, and student details before approving the request.'
          : 'Wait for admin approval before collecting any component from the lab.',
        'Damaged/consumed, missing, or misused components should be recorded during issue/return handling.',
      ]),
    };
  }

  if (status === 'Approved') {
    return {
      title: 'Issue notes and policy',
      html: noteList([
        'Treat the approved list as the issued component set for this order.',
        isAdmin
          ? 'Issue only the approved quantities and record any substitutions or remarks in the portal.'
          : 'Please use the issued components carefully and keep them safe until return.',
        'Any damaged/consumed or missing component should be declared during return so inventory can be updated correctly.',
      ]),
    };
  }

  if (status === 'Rejected') {
    return {
      title: 'Request notes',
      html: noteList([
        'This request was not issued, so no stock movement should happen for this order.',
        isAdmin
          ? 'Use remarks to explain the rejection clearly so the student can submit a corrected request if needed.'
          : 'Please review the admin remarks and place a fresh order if corrections are needed.',
        'If components were discussed offline, make sure they are not handed over outside the portal process.',
      ]),
    };
  }

  if (status === 'Return Requested') {
    return {
      title: 'Return notes and policy',
      html: noteList([
        'The student has initiated the return process for the issued components.',
        isAdmin
          ? 'Verify physical quantities, damage/consumption, and pending items before closing the order.'
          : 'Bring all issued components back together with any damaged/consumed parts, even if they are not working.',
        'Damaged/consumed and shortage details must be captured during verification so the final summary stays accurate.',
      ]),
    };
  }

  if (status === 'Partially Returned') {
    return {
      title: 'Partial return notes',
      html: noteList([
        'Only part of the issued components has been returned so far.',
        isAdmin
          ? 'Keep the order open until pending quantities are received or remarks clearly explain the shortage.'
          : 'Please return the remaining pending components as soon as possible.',
        'Any damaged/consumed quantity should stay recorded separately from pending quantity for accountability.',
      ]),
    };
  }

  if (status === 'Returned') {
    return {
      title: 'Return closure notes',
      html: noteList([
        'The table below represents the issued components and the verified return summary for this order.',
        isAdmin
          ? 'Check the damaged/consumed and pending columns before treating the order as fully closed in records.'
          : 'If any damage/consumption or shortage is shown, please follow the lab policy or admin guidance for closure.',
        'All damaged/consumed amounts, shortages, and remarks should remain attached to the order for audit and inventory tracking.',
      ]),
    };
  }

  return {
    title: 'Notes',
    html: noteList([
      'Please review the latest order status and remarks in the portal.',
      'Keep component issue, return, damage/consumption, and shortage records aligned with the physical stock.',
    ]),
  };
}

function wrapEmail(title, subtitle, bodyHtml) {
  const siteUrl = getSiteUrl();
  // A plain text link (not a filled button) reads less like a marketing
  // email to spam heuristics, while still being a real, working link.
  const footerLink = siteUrl
    ? `<p style="margin:16px 0 0;"><a href="${escapeHtml(siteUrl)}" style="color:#1a237e;font-weight:700;text-decoration:underline;">Open CIMS Portal &rarr;</a></p>`
    : '';

  // White letterhead, not a filled navy band -- the real logo is dark
  // navy/orange on a transparent background (same asset the order/invoice
  // PDFs use), so it needs white behind it or the navy parts of the mark
  // disappear. Matches the PDF letterhead: logo on white, navy accent rule,
  // then content.
  const orgName = getOrgName();
  const orgShortName = getOrgShortName();
  const logoHtml = LOGO_EXISTS
    ? `<img src="cid:${LOGO_CID}" alt="${escapeHtml(orgName)}" style="height:34px;display:block;margin-bottom:12px;" />`
    : `<div style="font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#64748b;font-weight:700;margin-bottom:10px;">${escapeHtml(orgName)} &middot; ${escapeHtml(orgShortName)}</div>`;

  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body style="margin:0;padding:24px;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;color:#16213e;">
  <div style="max-width:680px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #dbe3f0;">
    <div style="background:#ffffff;padding:24px 28px 18px;">
      ${logoHtml}
      <h1 style="margin:0;font-size:21px;font-weight:700;color:#1a1a2e;">${escapeHtml(title)}</h1>
      <p style="margin:6px 0 0;color:#64748b;font-size:13px;">${escapeHtml(subtitle)}</p>
    </div>
    <div style="height:3px;background:#1a237e;line-height:3px;font-size:0;">&nbsp;</div>
    <div style="padding:24px 28px;">
      ${bodyHtml}
      ${footerLink}
    </div>
    <div style="padding:14px 28px;background:#f8fafc;color:#64748b;font-size:12px;text-align:center;border-top:1px solid #e2e8f0;">
      Automated notification from the ${escapeHtml(orgShortName)} Component Inventory Management System, ${escapeHtml(orgName)}.<br>
      For urgent matters, use the Reply-To contact shown on this email instead of this address.
    </div>
  </div>
</body>
</html>`;
}

function statusTheme(status) {
  if (status === 'Approved') return { color: '#2e7d32', bg: '#e8f5e9', title: 'Order approved' };
  if (status === 'Rejected') return { color: '#c62828', bg: '#fce4ec', title: 'Order rejected' };
  if (status === 'Return Requested') return { color: '#ef6c00', bg: '#fff3e0', title: 'Return requested' };
  if (status === 'Partially Returned') return { color: '#1d4ed8', bg: '#e8f0fe', title: 'Partially returned' };
  if (status === 'Returned') return { color: '#1565c0', bg: '#e3f2fd', title: 'Order returned' };
  return { color: '#6b7280', bg: '#f3f4f6', title: `Order ${status}` };
}

async function sendMessage(transporter, options) {
  try {
    const needsLogo = LOGO_EXISTS && typeof options.html === 'string' && options.html.includes(`cid:${LOGO_CID}`);
    const attachments = [
      ...(options.attachments || []),
      ...(needsLogo ? [{ filename: 'logo.png', path: LOGO_PATH, cid: LOGO_CID }] : []),
    ];
    const info = await transporter.sendMail({
      ...options,
      attachments: attachments.length ? attachments : undefined,
      text: options.text || htmlToText(options.html),
    });
    console.log('[EMAIL SENT]', options.to, info.messageId || '');
    return { ok: true, messageId: info.messageId || '' };
  } catch (err) {
    console.error('[EMAIL ERROR]', err.message);
    return { ok: false, error: err.message };
  }
}

let verifyPromise = null;
let lastVerifyResult = null;

async function verifyEmailConnection(force = false) {
  const config = getSmtpConfig();
  if (!config.configured) {
    const result = {
      ok: false,
      configured: false,
      message: 'SMTP credentials are missing. Set SMTP_USER and SMTP_PASS in backend/.env.',
    };
    lastVerifyResult = result;
    return result;
  }

  if (lastVerifyResult?.ok && !force) {
    return lastVerifyResult;
  }

  if (!verifyPromise || force) {
    verifyPromise = (async () => {
      try {
        const transporter = createTransporter();
        await transporter.verify();
        const result = {
          ok: true,
          configured: true,
          message: `SMTP verified for ${config.user} via ${config.host}:${config.port}.`,
        };
        lastVerifyResult = result;
        return result;
      } catch (err) {
        const gmailHint = config.host.includes('gmail')
          ? ' Use a Gmail App Password with 2-Step Verification enabled.'
          : '';
        const result = {
          ok: false,
          configured: true,
          message: `SMTP verification failed: ${err.message}.${gmailHint}`.trim(),
        };
        lastVerifyResult = result;
        return result;
      } finally {
        verifyPromise = null;
      }
    })();
  }

  return verifyPromise;
}

async function ensureEmailReady(contextLabel) {
  const status = await verifyEmailConnection();
  if (!status.ok) {
    console.error(`[EMAIL SKIP] ${contextLabel}: ${status.message}`);
    return false;
  }
  return true;
}

async function sendOrderNotification(order, centerId) {
  if (!(await ensureEmailReady(`Order ${order.orderId}`))) {
    return;
  }

  const config = getSmtpConfig();
  const transporter = createTransporter();
  const adminRecipient = getAdminRecipient(centerId || order.centerId);
  const studentRecipient = order.studentEmail;
  const details = getStudentDetails(order);
  const items = getItems(order);
  const when = new Date(order.createdAt).toLocaleString('en-IN');
  const expectedReturnDate = formatDateOnly(details.expectedReturnDate || order.expectedReturnDate);
  const adminPendingNotes = buildPolicyNotes('Pending', 'admin');
  const studentPendingNotes = buildPolicyNotes('Pending', 'student');

  const adminHtml = wrapEmail(
    'New component order',
    'A student has placed a new CIMS request.',
    `
      <div style="padding:14px 16px;background:#eef2ff;border-left:4px solid #1a237e;border-radius:8px;margin-bottom:20px;">
        <strong>Order ID:</strong> ${escapeHtml(order.orderId)}<br>
        <strong>Date:</strong> ${escapeHtml(when)}<br>
        <strong>Status:</strong> Pending
      </div>
      <h3 style="margin:0 0 8px;color:#1a237e;">Student details</h3>
      <p style="margin:0 0 4px;"><strong>Name:</strong> ${escapeHtml(details.studentName)}</p>
      <p style="margin:0 0 4px;"><strong>Email:</strong> ${escapeHtml(order.studentEmail)}</p>
      <p style="margin:0 0 4px;"><strong>Mobile:</strong> ${escapeHtml(details.mobile)}</p>
      <p style="margin:0 0 4px;"><strong>College:</strong> ${escapeHtml(details.college)}</p>
      <p style="margin:0 0 4px;"><strong>Department:</strong> ${escapeHtml(details.department)}</p>
      <p style="margin:0 0 4px;"><strong>Course:</strong> ${escapeHtml(details.courseName)}</p>
      <p style="margin:0 0 4px;"><strong>Program:</strong> ${escapeHtml(details.programName || '-')}</p>
      ${details.projectName ? `<p style="margin:0 0 4px;"><strong>Project:</strong> ${escapeHtml(details.projectName)}</p>` : ''}
      <p style="margin:0 0 4px;"><strong>Team:</strong> ${escapeHtml(details.teamName)}</p>
      <p style="margin:0 0 4px;"><strong>Faculty Guide:</strong> ${escapeHtml(details.facultyGuide)}</p>
      ${expectedReturnDate ? `<p style="margin:0 0 12px;"><strong>Expected return date:</strong> ${escapeHtml(expectedReturnDate)}</p>` : ''}
      <h3 style="margin:20px 0 8px;color:#1a237e;">Requested items</h3>
      ${componentTable(items)}
      ${details.purpose ? `<div style="margin-top:16px;padding:14px 16px;background:#fff9c4;border-radius:8px;"><strong>Purpose:</strong> ${escapeHtml(details.purpose)}</div>` : ''}
      <div style="margin-top:16px;padding:14px 16px;background:#f8fafc;border:1px solid #dbe3f0;border-radius:10px;">
        <strong style="color:#1a237e;">${escapeHtml(adminPendingNotes.title)}</strong>
        ${adminPendingNotes.html}
      </div>
    `,
  );

  const studentHtml = wrapEmail(
    'Order received',
    'Your request has been recorded in CIMS and is waiting for admin review.',
    `
      <div style="padding:14px 16px;background:#eef2ff;border-left:4px solid #1a237e;border-radius:8px;margin-bottom:20px;">
        <strong>Order ID:</strong> ${escapeHtml(order.orderId)}<br>
        <strong>Date:</strong> ${escapeHtml(when)}<br>
        <strong>Status:</strong> Pending
      </div>
      ${expectedReturnDate ? `<p style="margin:0 0 12px;color:#475569;"><strong>Expected return date:</strong> ${escapeHtml(expectedReturnDate)}</p>` : ''}
      <p style="margin:0 0 12px;color:#475569;">The requested stock has been reserved for review. You will receive another email when the admin approves, rejects, or completes the return.</p>
      <h3 style="margin:20px 0 8px;color:#1a237e;">Requested items</h3>
      ${componentTable(items)}
      <p style="margin:16px 0 0;"><strong>Program:</strong> ${escapeHtml(details.programName || '-')}</p>
      ${details.projectName ? `<p style="margin:4px 0 0;"><strong>Project:</strong> ${escapeHtml(details.projectName)}</p>` : ''}
      <div style="margin-top:16px;padding:14px 16px;background:#f8fafc;border:1px solid #dbe3f0;border-radius:10px;">
        <strong style="color:#1a237e;">${escapeHtml(studentPendingNotes.title)}</strong>
        ${studentPendingNotes.html}
      </div>
    `,
  );

  const tasks = [];
  if (adminRecipient) {
    tasks.push(sendMessage(transporter, {
      from: `"${getSenderName()}" <${config.user}>`,
      to: adminRecipient,
      replyTo: buildReplyTo(studentRecipient, config.user),
      subject: `[CIMS] New order ${order.orderId} from ${details.studentName || order.username}`,
      html: adminHtml,
    }));
  }
  if (studentRecipient) {
    tasks.push(sendMessage(transporter, {
      from: `"${getSenderName()}" <${config.user}>`,
      to: studentRecipient,
      replyTo: buildReplyTo(adminRecipient, config.user),
      subject: `[CIMS] Order received ${order.orderId}`,
      html: studentHtml,
    }));
  }

  await Promise.allSettled(tasks);
}

async function sendProcurementNotification({ request, type, recipients = [] }) {
  if (!recipients.length) return;
  if (!(await ensureEmailReady(`Procurement request ${request.id}`))) {
    return;
  }

  const config = getSmtpConfig();
  const transporter = createTransporter();

  const typeLabels = {
    request: 'New component request',
    'status-update': `Request ${request.status}`,
  };
  const subject = type === 'request'
    ? `[CIMS] New component request from ${escapeHtml(request.centerName)}`
    : `[CIMS] Your component request is now: ${escapeHtml(request.status)}`;

  const summary = `
    <p style="margin:0 0 8px;"><strong>Center:</strong> ${escapeHtml(request.centerName)}</p>
    <p style="margin:0 0 8px;"><strong>Requested by:</strong> ${escapeHtml(request.requestedBy)}</p>
    <p style="margin:0 0 8px;"><strong>Program:</strong> ${escapeHtml(request.programName || 'N/A')}</p>
    <p style="margin:0 0 8px;"><strong>Status:</strong> ${escapeHtml(request.status)}</p>
    ${request.adminRemarks ? `<p style="margin:0 0 8px;"><strong>Remarks:</strong> ${escapeHtml(request.adminRemarks)}</p>` : ''}
  `;

  const bodyHtml = `
    ${summary}
    <h3 style="margin:16px 0 8px;color:#1a237e;">Requested components</h3>
    ${componentTable((request.items || []).map(i => ({ name: i.componentName, qty: i.qtyApproved ?? i.qtyRequested, unit: 'pcs' })))}
  `;

  const eventSubtitle = type === 'request'
    ? `From ${request.centerName || 'a center'}.`
    : `Request from ${request.centerName || 'a center'} is now: ${request.status}.`;
  const html = wrapEmail(
    typeLabels[type] || 'Component request update',
    eventSubtitle,
    bodyHtml,
  );

  const to = recipients.filter(Boolean).join(', ');
  if (!to) return;

  await sendMessage(transporter, {
    from: `"${getSenderName()}" <${config.user}>`,
    to,
    replyTo: buildReplyTo(config.user, ''),
    subject,
    html,
  });
}

async function sendTransferNotification({ transfer, type, recipients = [] }) {
  if (!recipients.length) return;
  if (!(await ensureEmailReady(`Transfer ${transfer.id}`))) {
    return;
  }

  const config = getSmtpConfig();
  const transporter = createTransporter();

  const typeLabels = {
    request: 'New transfer request',
    approved: 'Transfer approved',
    'return-request': 'Return requested',
    returned: 'Transfer returned',
  };
  const subject = typeLabels[type]
    ? `[CIMS] ${typeLabels[type]}: ${transfer.id}`
    : `[CIMS] Transfer update: ${transfer.id}`;

  const summary = `
    <p style="margin:0 0 8px;"><strong>Requesting center:</strong> ${escapeHtml(transfer.requestingCenterName)}</p>
    <p style="margin:0 0 8px;"><strong>Program name:</strong> ${escapeHtml(transfer.programName || 'N/A')}</p>
    <p style="margin:0 0 8px;"><strong>Purpose:</strong> ${escapeHtml(transfer.purpose || 'N/A')}</p>
    <p style="margin:0 0 8px;"><strong>Responsible:</strong> ${escapeHtml(transfer.responsiblePerson || 'N/A')} (${escapeHtml(transfer.responsibleEmail || 'N/A')})</p>
  `;

  const footerNote = type === 'request'
    ? 'This request awaits super admin approval.'
    : type === 'approved'
      ? `Supplied from ${escapeHtml(transfer.supplyCenterName || 'another center')}.`
      : type === 'return-request'
        ? 'A return has been requested; the supplying center will mark it received once the parts are back.'
        : 'Components have been returned to the supplying center.';

  const bodyHtml = `
    ${summary}
    <h3 style="margin:16px 0 8px;color:#1a237e;">Requested components</h3>
    ${componentTable(transfer.components || [])}
    <p style="margin-top:12px;color:#475569;">${escapeHtml(footerNote)}</p>
  `;

  const html = wrapEmail(
    typeLabels[type] || 'Component transfer update',
    `Transfer ${transfer.id} · ${transfer.requestingCenterName || 'Center transfer'}`,
    bodyHtml,
  );

  const to = recipients.filter(Boolean).join(', ');
  if (!to) return;

  await sendMessage(transporter, {
    from: `"${getSenderName()}" <${config.user}>`,
    to,
    replyTo: buildReplyTo(config.user, ''),
    subject,
    html,
  });
}

async function sendStatusUpdate(order, status, remarks, centerId) {
  if (!(await ensureEmailReady(`Status ${order.orderId} ${status}`))) {
    return;
  }

  const config = getSmtpConfig();
  const transporter = createTransporter();
  const adminRecipient = getAdminRecipient(centerId || order.centerId);
  const studentRecipient = order.studentEmail;
  const details = getStudentDetails(order);
  const items = getItems(order);
  const returnSummary = Array.isArray(order.returnSummary) ? order.returnSummary : [];
  const theme = statusTheme(status);
  const note = remarks ? `<p style="margin:12px 0 0;"><strong>Remarks:</strong> ${escapeHtml(remarks)}</p>` : '';
  const expectedReturnDate = formatDateOnly(details.expectedReturnDate || order.expectedReturnDate);
  const adminNotes = buildPolicyNotes(status, 'admin');
  const studentNotes = buildPolicyNotes(status, 'student');
  const rejectedItems = Array.isArray(order.rejectedItems) ? order.rejectedItems : [];
  const rejectedItemsHtml = rejectedItems.length
    ? `
      <div style="margin-top:12px;padding:12px 14px;background:#fff4f1;border:1px solid #f0c2bf;border-radius:8px;">
        <strong style="color:#c62828;">Components not issued</strong>
        ${componentBulletList(rejectedItems)}
      </div>
    `
    : '';

  const RETURN_FLOW_STATUSES = new Set(['Return Requested', 'Partially Returned', 'Returned']);
  const showReturnSummary = RETURN_FLOW_STATUSES.has(status) && returnSummary.length > 0;

  let itemsSectionHtml = '';
  if (showReturnSummary) {
    itemsSectionHtml = `
      <h3 style="margin:20px 0 8px;color:#1a237e;">Return Summary</h3>
      ${returnSummaryTable(returnSummary)}
    `;
  } else {
    const itemHeading = status === 'Approved' ? 'Components Issued' : 'Requested Components';
    itemsSectionHtml = `
      <h3 style="margin:20px 0 8px;color:#1a237e;">${escapeHtml(itemHeading)}</h3>
      ${componentTable(items)}
    `;
  }

  const sharedBlock = (audienceNotes) => `
    <div style="padding:14px 16px;background:${theme.bg};border-left:4px solid ${theme.color};border-radius:8px;margin-bottom:20px;">
      <strong style="color:${theme.color};">${escapeHtml(theme.title)}</strong><br>
      <span style="color:#475569;">Order ID: ${escapeHtml(order.orderId)}</span>
      ${expectedReturnDate ? `<br><span style="color:#475569;">Expected return date: ${escapeHtml(expectedReturnDate)}</span>` : ''}
      ${note}
    </div>
    ${itemsSectionHtml}
    ${rejectedItemsHtml}
    <div style="margin-top:16px;padding:14px 16px;background:#f8fafc;border:1px solid #dbe3f0;border-radius:10px;">
      <strong style="color:#1a237e;">${escapeHtml(audienceNotes.title)}</strong>
      ${audienceNotes.html}
    </div>
  `;

  const adminHtml = wrapEmail(
    `Order status changed: ${status}`,
    'CIMS has recorded a new order lifecycle update.',
    `
      ${sharedBlock(adminNotes)}
      <p style="margin:16px 0 4px;"><strong>Student:</strong> ${escapeHtml(details.studentName || order.username)}</p>
      <p style="margin:0 0 4px;"><strong>Email:</strong> ${escapeHtml(order.studentEmail)}</p>
      <p style="margin:0 0 4px;"><strong>Program:</strong> ${escapeHtml(details.programName || '-')}</p>
      ${details.projectName ? `<p style="margin:0 0 4px;"><strong>Project:</strong> ${escapeHtml(details.projectName)}</p>` : ''}
      <p style="margin:0;"><strong>Current status:</strong> ${escapeHtml(status)}</p>
    `,
  );

  const studentHtml = wrapEmail(
    `Order update: ${status}`,
    'Your CIMS order status has changed.',
    `
      ${sharedBlock(studentNotes)}
      <p style="margin:16px 0 0;color:#475569;">If you have completed your work, use the portal return option so the admin can receive the components back and inventory can be updated.</p>
    `,
  );

  const tasks = [];
  if (adminRecipient) {
    tasks.push(sendMessage(transporter, {
      from: `"${getSenderName()}" <${config.user}>`,
      to: adminRecipient,
      replyTo: buildReplyTo(studentRecipient, config.user),
      subject: `[CIMS] ${status}: ${order.orderId}`,
      html: adminHtml,
    }));
  }
  if (studentRecipient) {
    tasks.push(sendMessage(transporter, {
      from: `"${getSenderName()}" <${config.user}>`,
      to: studentRecipient,
      replyTo: buildReplyTo(adminRecipient, config.user),
      subject: `[CIMS] ${status}: ${order.orderId}`,
      html: studentHtml,
    }));
  }

  await Promise.allSettled(tasks);
}

async function sendReturnReminder(order, centerId) {
  if (!(await ensureEmailReady(`Return reminder ${order.orderId}`))) {
    return { ok: false, skipped: true };
  }

  const config = getSmtpConfig();
  const transporter = createTransporter();
  const studentRecipient = order.studentEmail;
  if (!studentRecipient) {
    return { ok: false, skipped: true };
  }

  const adminRecipient = getAdminRecipient(centerId || order.centerId);
  const details = getStudentDetails(order);
  const items = getItems(order);
  const expectedReturnDate = formatDateOnly(details.expectedReturnDate || order.expectedReturnDate);

  const html = wrapEmail(
    'Upcoming component return reminder',
    'Your expected return date is tomorrow.',
    `
      <div style="padding:14px 16px;background:#fff7ed;border-left:4px solid #ea580c;border-radius:8px;margin-bottom:20px;">
        <strong>Order ID:</strong> ${escapeHtml(order.orderId)}<br>
        <strong>Expected return date:</strong> ${escapeHtml(expectedReturnDate)}
      </div>
      <p style="margin:0 0 12px;color:#475569;">This is a reminder to return the issued components by the expected date to help the lab keep inventory accurate for other students.</p>
      <h3 style="margin:20px 0 8px;color:#1a237e;">Components issued</h3>
      ${componentTable(items)}
      <div style="margin-top:16px;padding:14px 16px;background:#f8fafc;border:1px solid #dbe3f0;border-radius:10px;">
        <strong style="color:#1a237e;">Return notes and policy</strong>
        ${noteList([
          'Please return all issued components in working condition wherever possible.',
          'If any component is damaged/consumed or missing, inform the lab/admin during the return process so the order summary can be updated correctly.',
          'Use the portal return option or contact the lab/admin if you need clarification before returning the components.',
        ])}
      </div>
    `,
  );

  return sendMessage(transporter, {
    from: `"${getSenderName()}" <${config.user}>`,
    to: studentRecipient,
    replyTo: buildReplyTo(adminRecipient, config.user),
    subject: `[CIMS] Return reminder for ${order.orderId}`,
    html,
  });
}

// Shared by forgot-password (routes/auth.js) and student order confirmation
// (routes/orders.js) -- same code-in-a-box template, different copy per
// purpose. targetEmail is passed explicitly by the caller rather than read
// off the user record: forgot-password always uses the account's on-file
// email (the whole point is proving control of that account), while order
// confirmation sends to whatever email the student has on the checkout form
// at that moment, which may not be saved to their profile.
async function sendOtpEmail({ targetEmail, centerId, code, purpose, expiresInMinutes }) {
  if (!targetEmail) return { ok: false, skipped: true, reason: 'no_email' };
  if (!(await ensureEmailReady(`OTP (${purpose}) to ${targetEmail}`))) {
    return { ok: false, skipped: true };
  }

  const config = getSmtpConfig();
  const transporter = createTransporter();
  const copy = purpose === 'password_reset'
    ? { title: 'Reset your CIMS password', subtitle: 'Use this code to reset your password.', subject: '[CIMS] Password reset code' }
    : { title: 'Confirm your order', subtitle: 'Use this code to confirm and submit your component request.', subject: '[CIMS] Order confirmation code' };

  const html = wrapEmail(
    copy.title,
    copy.subtitle,
    `
      <div style="text-align:center;padding:22px 16px;background:#eef2ff;border-radius:12px;margin-bottom:18px;">
        <div style="font-size:13px;color:#475569;margin-bottom:8px;">Your verification code</div>
        <div style="font-size:34px;font-weight:800;letter-spacing:8px;color:#1a237e;">${escapeHtml(code)}</div>
      </div>
      <p style="margin:0 0 8px;color:#475569;">This code expires in ${escapeHtml(String(expiresInMinutes))} minutes and can only be used once.</p>
      <p style="margin:0;color:#94a3b8;font-size:12px;">If you didn't request this, you can safely ignore this email -- no changes will be made without the code above.</p>
    `,
  );

  return sendMessage(transporter, {
    from: `"${getSenderName()}" <${config.user}>`,
    to: targetEmail,
    replyTo: buildReplyTo(getAdminRecipient(centerId), config.user),
    subject: copy.subject,
    html,
  });
}

module.exports = {
  buildReplyTo,
  ensureEmailReady,
  getAdminRecipient,
  getSiteUrl,
  readCenterSpecificEnv,
  readEnv,
  getSmtpConfig,
  sendMessage,
  sendOrderNotification,
  sendStatusUpdate,
  sendTransferNotification,
  sendProcurementNotification,
  sendReturnReminder,
  sendOtpEmail,
  verifyEmailConnection,
};
