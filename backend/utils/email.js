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
        <tr style="background:#2d2a6e;color:#fff;">
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
        <tr style="background:#2d2a6e;color:#fff;">
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
          : 'Wait for admin approval before collecting any component from the center.',
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
          : 'If any damage/consumption or shortage is shown, please follow the center policy or admin guidance for closure.',
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
    ? `<p style="margin:16px 0 0;"><a href="${escapeHtml(siteUrl)}" style="color:#2d2a6e;font-weight:700;text-decoration:underline;">Open ${escapeHtml(getOrgShortName())} Portal &rarr;</a></p>`
    : '';

  // White letterhead, not a filled navy band -- the real logo is dark
  // navy/orange on a transparent background (same asset the order/invoice
  // PDFs use), so it needs white behind it or the navy parts of the mark
  // disappear. Matches the PDF letterhead: logo on white, navy accent rule,
  // then content.
  const orgName = getOrgName();
  const orgShortName = getOrgShortName();
  const logoHtml = LOGO_EXISTS
    ? `<img src="cid:${LOGO_CID}" alt="${escapeHtml(orgName)}" style="height:48px;display:block;margin-bottom:14px;" />`
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
    <div style="height:3px;background:#2d2a6e;line-height:3px;font-size:0;">&nbsp;</div>
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
    `A student has placed a new ${getOrgShortName()} request.`,
    `
      <div style="padding:14px 16px;background:#eef2ff;border-left:4px solid #2d2a6e;border-radius:8px;margin-bottom:20px;">
        <strong>Order ID:</strong> ${escapeHtml(order.orderId)}<br>
        <strong>Date:</strong> ${escapeHtml(when)}<br>
        <strong>Status:</strong> Pending
      </div>
      <h3 style="margin:0 0 8px;color:#2d2a6e;">Student details</h3>
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
      <h3 style="margin:20px 0 8px;color:#2d2a6e;">Requested items</h3>
      ${componentTable(items)}
      ${details.purpose ? `<div style="margin-top:16px;padding:14px 16px;background:#fff9c4;border-radius:8px;"><strong>Purpose:</strong> ${escapeHtml(details.purpose)}</div>` : ''}
      <div style="margin-top:16px;padding:14px 16px;background:#f8fafc;border:1px solid #dbe3f0;border-radius:10px;">
        <strong style="color:#2d2a6e;">${escapeHtml(adminPendingNotes.title)}</strong>
        ${adminPendingNotes.html}
      </div>
    `,
  );

  const studentHtml = wrapEmail(
    'Order received',
    `Your request has been recorded in ${getOrgShortName()} and is waiting for admin review.`,
    `
      <div style="padding:14px 16px;background:#eef2ff;border-left:4px solid #2d2a6e;border-radius:8px;margin-bottom:20px;">
        <strong>Order ID:</strong> ${escapeHtml(order.orderId)}<br>
        <strong>Date:</strong> ${escapeHtml(when)}<br>
        <strong>Status:</strong> Pending
      </div>
      ${expectedReturnDate ? `<p style="margin:0 0 12px;color:#475569;"><strong>Expected return date:</strong> ${escapeHtml(expectedReturnDate)}</p>` : ''}
      <p style="margin:0 0 12px;color:#475569;">The requested stock has been reserved for review. You will receive another email when the admin approves, rejects, or completes the return.</p>
      <h3 style="margin:20px 0 8px;color:#2d2a6e;">Requested items</h3>
      ${componentTable(items)}
      <p style="margin:16px 0 0;"><strong>Program:</strong> ${escapeHtml(details.programName || '-')}</p>
      ${details.projectName ? `<p style="margin:4px 0 0;"><strong>Project:</strong> ${escapeHtml(details.projectName)}</p>` : ''}
      <div style="margin-top:16px;padding:14px 16px;background:#f8fafc;border:1px solid #dbe3f0;border-radius:10px;">
        <strong style="color:#2d2a6e;">${escapeHtml(studentPendingNotes.title)}</strong>
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
      subject: `[${getOrgShortName()}] New order ${order.orderId} from ${details.studentName || order.username}`,
      html: adminHtml,
    }));
  }
  if (studentRecipient) {
    tasks.push(sendMessage(transporter, {
      from: `"${getSenderName()}" <${config.user}>`,
      to: studentRecipient,
      replyTo: buildReplyTo(adminRecipient, config.user),
      subject: `[${getOrgShortName()}] Order received ${order.orderId}`,
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
    ? `[${getOrgShortName()}] New component request from ${escapeHtml(request.centerName)}`
    : `[${getOrgShortName()}] Your component request is now: ${escapeHtml(request.status)}`;

  const summary = `
    <p style="margin:0 0 8px;"><strong>Center:</strong> ${escapeHtml(request.centerName)}</p>
    <p style="margin:0 0 8px;"><strong>Requested by:</strong> ${escapeHtml(request.requestedBy)}</p>
    <p style="margin:0 0 8px;"><strong>Program:</strong> ${escapeHtml(request.programName || 'N/A')}</p>
    <p style="margin:0 0 8px;"><strong>Status:</strong> ${escapeHtml(request.status)}</p>
    ${request.adminRemarks ? `<p style="margin:0 0 8px;"><strong>Remarks:</strong> ${escapeHtml(request.adminRemarks)}</p>` : ''}
  `;

  const bodyHtml = `
    ${summary}
    <h3 style="margin:16px 0 8px;color:#2d2a6e;">Requested components</h3>
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
    ? `[${getOrgShortName()}] ${typeLabels[type]}: ${transfer.id}`
    : `[${getOrgShortName()}] Transfer update: ${transfer.id}`;

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
    <h3 style="margin:16px 0 8px;color:#2d2a6e;">Requested components</h3>
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
      <h3 style="margin:20px 0 8px;color:#2d2a6e;">Return Summary</h3>
      ${returnSummaryTable(returnSummary)}
    `;
  } else {
    const itemHeading = status === 'Approved' ? 'Components Issued' : 'Requested Components';
    itemsSectionHtml = `
      <h3 style="margin:20px 0 8px;color:#2d2a6e;">${escapeHtml(itemHeading)}</h3>
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
      <strong style="color:#2d2a6e;">${escapeHtml(audienceNotes.title)}</strong>
      ${audienceNotes.html}
    </div>
  `;

  const adminHtml = wrapEmail(
    `Order status changed: ${status}`,
    `${getOrgShortName()} has recorded a new order lifecycle update.`,
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
    `Your ${getOrgShortName()} order status has changed.`,
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
      subject: `[${getOrgShortName()}] ${status}: ${order.orderId}`,
      html: adminHtml,
    }));
  }
  if (studentRecipient) {
    tasks.push(sendMessage(transporter, {
      from: `"${getSenderName()}" <${config.user}>`,
      to: studentRecipient,
      replyTo: buildReplyTo(adminRecipient, config.user),
      subject: `[${getOrgShortName()}] ${status}: ${order.orderId}`,
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
      <p style="margin:0 0 12px;color:#475569;">This is a reminder to return the issued components by the expected date to help the center keep inventory accurate for other students.</p>
      <h3 style="margin:20px 0 8px;color:#2d2a6e;">Components issued</h3>
      ${componentTable(items)}
      <div style="margin-top:16px;padding:14px 16px;background:#f8fafc;border:1px solid #dbe3f0;border-radius:10px;">
        <strong style="color:#2d2a6e;">Return notes and policy</strong>
        ${noteList([
          'Please return all issued components in working condition wherever possible.',
          'If any component is damaged/consumed or missing, inform the center admin during the return process so the order summary can be updated correctly.',
          'Use the portal return option or contact the center admin if you need clarification before returning the components.',
        ])}
      </div>
    `,
  );

  return sendMessage(transporter, {
    from: `"${getSenderName()}" <${config.user}>`,
    to: studentRecipient,
    replyTo: buildReplyTo(adminRecipient, config.user),
    subject: `[${getOrgShortName()}] Return reminder for ${order.orderId}`,
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
    ? { title: `Reset your ${getOrgShortName()} password`, subtitle: 'Use this code to reset your password.', subject: `[${getOrgShortName()}] Password reset code` }
    : { title: 'Confirm your order', subtitle: 'Use this code to confirm and submit your component request.', subject: `[${getOrgShortName()}] Order confirmation code` };

  const html = wrapEmail(
    copy.title,
    copy.subtitle,
    `
      <div style="text-align:center;padding:22px 16px;background:#eef2ff;border-radius:12px;margin-bottom:18px;">
        <div style="font-size:13px;color:#475569;margin-bottom:8px;">Your verification code</div>
        <div style="font-size:34px;font-weight:800;letter-spacing:8px;color:#2d2a6e;">${escapeHtml(code)}</div>
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

// ---------- Account lifecycle ----------
//
// The order lifecycle was fully covered by email, but the account lifecycle
// was silent: a student who registered heard nothing until they tried to log
// in, the center admin was never told there was someone to approve, and an
// account created by an admin got no welcome. These close those gaps.
//
// None of these emails ever contains a password. An admin-created account's
// initial password is handed over by the admin in person; the email tells the
// user how to change it and how to reset it if they never received one.

function accountFacts(user, centerName) {
  return `
    <div style="padding:14px 16px;background:#eef2ff;border-left:4px solid #2d2a6e;border-radius:8px;margin-bottom:20px;">
      <strong>Username:</strong> ${escapeHtml(user.username)}<br>
      <strong>Name:</strong> ${escapeHtml(user.fullName || '')}<br>
      ${centerName ? `<strong>Center:</strong> ${escapeHtml(centerName)}<br>` : ''}
      <strong>Role:</strong> ${escapeHtml(String(user.role || 'student').replace('_', ' '))}
    </div>
  `;
}

// Student self-registered: confirm to the student, and tell the center admin
// there is a pending approval.
async function sendRegistrationSubmitted({ user, centerId, centerName }) {
  if (!(await ensureEmailReady(`Registration ${user.username}`))) return;

  const config = getSmtpConfig();
  const transporter = createTransporter();
  const adminRecipient = getAdminRecipient(centerId);
  const org = getOrgShortName();

  const tasks = [];

  if (user.email) {
    tasks.push(sendMessage(transporter, {
      from: `"${getSenderName()}" <${config.user}>`,
      to: user.email,
      replyTo: buildReplyTo(adminRecipient, config.user),
      subject: `[${org}] Registration received - awaiting approval`,
      html: wrapEmail(
        'Registration received',
        `Thanks for registering with ${getOrgName()}.`,
        `
          ${accountFacts(user, centerName)}
          <p style="margin:0 0 12px;color:#475569;">Your account is waiting for the center admin to approve it. You will get another email once it is active, and can then sign in with the username above and the password you chose.</p>
          <p style="margin:0;color:#475569;">If you do not hear back within a couple of working days, contact your center admin.</p>
        `,
      ),
    }));
  }

  if (adminRecipient) {
    tasks.push(sendMessage(transporter, {
      from: `"${getSenderName()}" <${config.user}>`,
      to: adminRecipient,
      replyTo: buildReplyTo(user.email, config.user),
      subject: `[${org}] New student registration to approve: ${user.fullName || user.username}`,
      html: wrapEmail(
        'New registration awaiting approval',
        `A student has registered for ${centerName || 'your center'}.`,
        `
          ${accountFacts(user, centerName)}
          <p style="margin:0 0 4px;"><strong>Email:</strong> ${escapeHtml(user.email || '-')}</p>
          <p style="margin:0 0 4px;"><strong>Mobile:</strong> ${escapeHtml(user.mobile || '-')}</p>
          <p style="margin:0 0 4px;"><strong>College:</strong> ${escapeHtml(user.college || '-')}</p>
          <p style="margin:0 0 4px;"><strong>Department:</strong> ${escapeHtml(user.department || '-')}</p>
          <p style="margin:0 0 12px;"><strong>Graduation year:</strong> ${escapeHtml(user.graduationYear || '-')}</p>
          <p style="margin:0;color:#475569;">Open <strong>Users</strong> in the portal to approve or reject this registration. The student cannot sign in until approved.</p>
        `,
      ),
    }));
  }

  await Promise.allSettled(tasks);
}

// Admin approved a self-registered account: the student can now sign in.
async function sendAccountApproved({ user, centerId, centerName }) {
  if (!user.email) return;
  if (!(await ensureEmailReady(`Account approved ${user.username}`))) return;

  const config = getSmtpConfig();
  const transporter = createTransporter();

  return sendMessage(transporter, {
    from: `"${getSenderName()}" <${config.user}>`,
    to: user.email,
    replyTo: buildReplyTo(getAdminRecipient(centerId), config.user),
    subject: `[${getOrgShortName()}] Your account is approved`,
    html: wrapEmail(
      'Your account is active',
      `Your ${getOrgName()} registration has been approved.`,
      `
        ${accountFacts(user, centerName)}
        <p style="margin:0 0 12px;color:#475569;">Sign in with the username above and the password you chose at registration. You can browse components, place requests for your projects, and track returns from the portal.</p>
        <p style="margin:0;color:#475569;">Forgot your password? Use <strong>Forgot password</strong> on the sign-in page to receive a reset code by email.</p>
      `,
    ),
  });
}

// An admin created this account directly. Carries a single-use set-password
// link (a long token, valid for days) so the person sets their own password
// rather than receiving one second-hand. The password itself is never mailed.
async function sendAccountCreated({ user, centerId, centerName, createdBy, setPasswordUrl, linkValidHours }) {
  if (!user.email) return;
  if (!(await ensureEmailReady(`Account created ${user.username}`))) return;

  const config = getSmtpConfig();
  const transporter = createTransporter();
  const isStaff = user.role === 'admin' || user.role === 'super_admin';

  const linkBlock = setPasswordUrl
    ? `
        <p style="margin:0 0 14px;color:#475569;">Set your password to activate your sign-in:</p>
        <p style="margin:0 0 18px;text-align:center;">
          <a href="${escapeHtml(setPasswordUrl)}" style="display:inline-block;background:#2d2a6e;color:#ffffff;font-weight:700;padding:12px 22px;border-radius:10px;text-decoration:none;">Set my password</a>
        </p>
        <p style="margin:0 0 12px;color:#94a3b8;font-size:12px;">This link works once and expires in ${escapeHtml(String(linkValidHours || 72))} hours. If it has expired, use <strong>Forgot password</strong> on the sign-in page to get a new code.</p>
        <p style="margin:0 0 12px;color:#94a3b8;font-size:12px;word-break:break-all;">If the button does not work, copy this address into your browser:<br>${escapeHtml(setPasswordUrl)}</p>
      `
    : `
        <p style="margin:0 0 12px;color:#475569;">Use <strong>Forgot password</strong> on the sign-in page to set your password with a code sent to this email address.</p>
      `;

  return sendMessage(transporter, {
    from: `"${getSenderName()}" <${config.user}>`,
    to: user.email,
    replyTo: buildReplyTo(getAdminRecipient(centerId), config.user),
    subject: `[${getOrgShortName()}] Your ${isStaff ? 'admin' : 'student'} account has been created - set your password`,
    html: wrapEmail(
      `Welcome to ${getOrgShortName()}`,
      `An account has been created for you on the ${getOrgName()} inventory portal.`,
      `
        ${accountFacts(user, centerName)}
        ${createdBy ? `<p style="margin:0 0 14px;color:#475569;">Created by: ${escapeHtml(createdBy)}</p>` : ''}
        ${linkBlock}
        <p style="margin:0;color:#475569;">For your security, passwords are never sent by email. Do not share this link.</p>
      `,
    ),
  });
}

// Security notice after any password change or reset. Sent to the address on
// file so the real owner learns about a change they did not make.
async function sendPasswordChanged({ user, centerId, method = 'changed' }) {
  if (!user.email) return;
  if (!(await ensureEmailReady(`Password changed ${user.username}`))) return;

  const config = getSmtpConfig();
  const transporter = createTransporter();
  const when = new Date().toLocaleString('en-IN');
  const how = method === 'reset' ? 'reset using an emailed code' : 'changed from the portal';

  return sendMessage(transporter, {
    from: `"${getSenderName()}" <${config.user}>`,
    to: user.email,
    replyTo: buildReplyTo(getAdminRecipient(centerId), config.user),
    subject: `[${getOrgShortName()}] Your password was ${method === 'reset' ? 'reset' : 'changed'}`,
    html: wrapEmail(
      'Password updated',
      `The password for ${user.username} was ${how}.`,
      `
        <div style="padding:14px 16px;background:#fff7ed;border-left:4px solid #ea580c;border-radius:8px;margin-bottom:20px;">
          <strong>Account:</strong> ${escapeHtml(user.username)}<br>
          <strong>When:</strong> ${escapeHtml(when)}
        </div>
        <p style="margin:0 0 12px;color:#475569;">If you made this change, no action is needed.</p>
        <p style="margin:0;color:#475569;"><strong>If you did not</strong>, reset your password immediately using <strong>Forgot password</strong> on the sign-in page, and tell your center admin.</p>
      `,
    ),
  });
}

// "Send test" from Settings: confirms a newly entered order-notification
// address actually receives mail before a real order depends on it.
async function sendTestEmail({ to, requestedBy = '' }) {
  if (!to) return { ok: false, message: 'No email address to send to.' };
  if (!(await ensureEmailReady(`Test email to ${to}`))) {
    return { ok: false, message: 'SMTP is not configured. Set SMTP_USER and SMTP_PASS in backend/.env.' };
  }
  const config = getSmtpConfig();
  const transporter = createTransporter();
  const org = getOrgShortName();
  const result = await sendMessage(transporter, {
    from: `"${getSenderName()}" <${config.user}>`,
    to,
    replyTo: buildReplyTo(config.user, ''),
    subject: `[${org}] Test notification`,
    html: wrapEmail(
      'Test notification',
      `This address is set to receive ${org} order notifications.`,
      `
        <p style="margin:0 0 12px;color:#475569;">If you are reading this, order alerts sent to <strong>${escapeHtml(to)}</strong> are working.</p>
        <p style="margin:0;color:#94a3b8;font-size:12px;">Sent by ${escapeHtml(requestedBy || 'an administrator')} from Settings at ${escapeHtml(new Date().toLocaleString('en-IN'))}. No action is needed.</p>
      `,
    ),
  });
  return { ...(result || {}), to };
}

module.exports = {
  sendTestEmail,
  sendRegistrationSubmitted,
  sendAccountApproved,
  sendAccountCreated,
  sendPasswordChanged,
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
