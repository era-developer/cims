const { getDb } = require('./db');

// Runtime-editable org settings, backed by the app_settings table.
//
// Resolution order for every value is: database -> environment -> built-in
// default. The env layer is what keeps the original Comedkare deployment
// working unchanged (its .env still holds SMTP_*, CENTER_EMAIL and the
// N8N_WHATSAPP_* keys); the database layer is what lets a super admin
// re-point notifications from the UI when the responsible admin changes.

const KEYS = {
  ORG_NAME: 'org.name',
  ORG_SHORT_NAME: 'org.short_name',
  ORG_TAGLINE: 'org.tagline',
  ORG_SITE_URL: 'org.site_url',
  EMAIL_SENDER_NAME: 'notify.email_sender_name',
  ORDER_EMAIL: 'notify.order_email',
  WHATSAPP_ADMIN: 'notify.whatsapp_admin',
};

// Only these may be written through the settings API. Anything else a client
// sends is ignored rather than silently persisted, so a typo'd key can't
// quietly shadow a real one later.
const WRITABLE_KEYS = new Set(Object.values(KEYS));

// Accepts 9686737460, +91 96867 37460, 091-9686737460 ... all the shapes a
// phone number gets typed in, and stores one canonical form. Shared by the
// settings endpoint and by center create/update so a number means the same
// thing wherever it was entered -- WhatsApp delivery should not depend on how
// carefully someone pasted it.
function normalizePhone(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  const digits = raw.replace(/[^\d]/g, '');
  if (!digits) return '';
  if (raw.startsWith('+')) return `+${digits}`;
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`;
  if (digits.length === 11 && digits.startsWith('0')) return `+91${digits.slice(1)}`;
  return `+${digits}`;
}

function readEnv(name) {
  const value = process.env[name];
  if (value === undefined || value === null) return '';
  return String(value).trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}

// The settings table is read on essentially every notification and on every
// branding lookup, but written a handful of times a year. A process-local
// cache keeps that from becoming a per-email SQLite round trip; every writer
// in this module clears it, and a stale read can only happen across processes
// (the service runs single-process, so in practice it cannot).
let cache = null;

function loadAll() {
  if (cache) return cache;
  const rows = getDb().prepare('SELECT key, value FROM app_settings').all();
  cache = new Map(rows.map(row => [row.key, row.value]));
  return cache;
}

function invalidate() {
  cache = null;
}

function getSetting(key) {
  const value = loadAll().get(key);
  return value === undefined || value === null ? '' : String(value).trim();
}

function setSetting(key, value, updatedBy = null) {
  getDb().prepare(`
    INSERT INTO app_settings (key, value, updated_at, updated_by)
    VALUES (?, ?, datetime('now'), ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by
  `).run(key, String(value ?? '').trim(), updatedBy);
  invalidate();
}

// Writes many keys under one transaction so a half-applied settings save can
// never leave, say, a new order email without its matching WhatsApp number.
function setSettings(entries, updatedBy = null) {
  const db = getDb();
  const pairs = Object.entries(entries).filter(([key]) => WRITABLE_KEYS.has(key));
  if (!pairs.length) return [];

  db.exec('BEGIN');
  try {
    for (const [key, value] of pairs) setSetting(key, value, updatedBy);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    invalidate();
    throw error;
  }
  return pairs.map(([key]) => key);
}

function resolve(key, envNames = [], fallback = '') {
  const stored = getSetting(key);
  if (stored) return stored;
  for (const envName of envNames) {
    const envValue = readEnv(envName);
    if (envValue) return envValue;
  }
  return fallback;
}

// ---------- Branding ----------

function getOrgName() {
  return resolve(KEYS.ORG_NAME, ['ORG_NAME'], 'Kalam Pragati');
}

function getOrgShortName() {
  return resolve(KEYS.ORG_SHORT_NAME, ['ORG_SHORT_NAME'], 'KIMS');
}

function getOrgTagline() {
  return resolve(KEYS.ORG_TAGLINE, ['ORG_TAGLINE'], 'Empowering Engineers with Skills for Success');
}

function getSiteUrl() {
  return resolve(KEYS.ORG_SITE_URL, ['SITE_URL'], '');
}

// The `from` display name on every outgoing email. Was hardcoded as
// "Comedkares Innovation Hub - CIMS" in eight places in utils/email.js.
function getEmailSenderName() {
  const stored = resolve(KEYS.EMAIL_SENDER_NAME, ['EMAIL_SENDER_NAME'], '');
  if (stored) return stored;
  return `${getOrgName()} - ${getOrgShortName()}`;
}

// ---------- Notification routing ----------

// Accepts either a raw `centers` row (snake_case, as read straight from
// SQLite) or the camelCase object utils/centers.js hands back. Callers pass
// whichever they happen to hold, and a silent miss here would route every
// center's notifications to the org-wide default.
function centerField(centerRow, camelKey, snakeKey) {
  if (!centerRow) return '';
  const value = centerRow[camelKey] ?? centerRow[snakeKey];
  return String(value || '').trim();
}

// Per-center value wins over the org-wide default, mirroring the env-var
// precedence ({CENTER_ID}_EMAIL beat CENTER_EMAIL) that this replaces.
function getOrderEmail(centerId, centerRow = null) {
  const perCenter = centerField(centerRow, 'notificationEmail', 'notification_email');
  if (perCenter) return perCenter;
  return resolve(KEYS.ORDER_EMAIL, ['CENTER_EMAIL', 'SMTP_USER'], '');
}

function getWhatsAppAdmin(centerId, centerRow = null) {
  const perCenter = centerField(centerRow, 'whatsappNumber', 'whatsapp_number');
  if (perCenter) return perCenter;
  return resolve(KEYS.WHATSAPP_ADMIN, ['N8N_WHATSAPP_ADMIN_TO'], '');
}

// Everything the settings screen renders, with the resolved value plus where
// it came from so the UI can show "inherited from .env" vs "set here".
function getAllResolved() {
  return {
    orgName: getOrgName(),
    orgShortName: getOrgShortName(),
    orgTagline: getOrgTagline(),
    siteUrl: getSiteUrl(),
    emailSenderName: getEmailSenderName(),
    orderEmail: getOrderEmail(null),
    whatsappAdmin: getWhatsAppAdmin(null),
    stored: Object.fromEntries(
      Object.values(KEYS).map(key => [key, getSetting(key)])
    ),
  };
}

module.exports = {
  KEYS,
  WRITABLE_KEYS,
  normalizePhone,
  getSetting,
  setSetting,
  setSettings,
  invalidate,
  getOrgName,
  getOrgShortName,
  getOrgTagline,
  getSiteUrl,
  getEmailSenderName,
  getOrderEmail,
  getWhatsAppAdmin,
  getAllResolved,
};
