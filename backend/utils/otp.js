// Shared one-time-passcode lifecycle for forgot-password (routes/auth.js)
// and student order confirmation (routes/orders.js). Both need exactly the
// same behavior: generate a code, email it, verify with a limited number of
// attempts, expire it, and make it single-use -- so this lives in one place
// instead of being duplicated per feature.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const OTP_LENGTH = 6;
const EXPIRY_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_SECONDS = 45;

function generateCode() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(OTP_LENGTH, '0');
}

// Creates and stores a new code, unless a still-valid one was issued too
// recently (RESEND_COOLDOWN_SECONDS) -- in that case no new code is created
// or emailed, and the caller gets told how much longer to wait rather than
// silently spamming the recipient's inbox on rapid repeat requests.
async function createOtp(db, { userId, purpose, targetEmail }) {
  const now = new Date();
  const recent = db.prepare(`
    SELECT created_at FROM otp_codes
    WHERE user_id = ? AND purpose = ? AND consumed_at IS NULL AND expires_at > ?
    ORDER BY created_at DESC LIMIT 1
  `).get(userId, purpose, now.toISOString());
  if (recent) {
    const secondsSince = (now - new Date(recent.created_at)) / 1000;
    if (secondsSince < RESEND_COOLDOWN_SECONDS) {
      return { code: null, cooldownRemaining: Math.ceil(RESEND_COOLDOWN_SECONDS - secondsSince) };
    }
  }
  // Invalidate any other still-active code for this user+purpose so only
  // the newest one is ever valid -- avoids a stale earlier code lingering
  // as a second valid answer.
  db.prepare(`UPDATE otp_codes SET consumed_at = ? WHERE user_id = ? AND purpose = ? AND consumed_at IS NULL`)
    .run(now.toISOString(), userId, purpose);

  const code = generateCode();
  const codeHash = await bcrypt.hash(code, 8);
  const expiresAt = new Date(now.getTime() + EXPIRY_MINUTES * 60000).toISOString();
  db.prepare(`
    INSERT INTO otp_codes (id, user_id, purpose, code_hash, target_email, expires_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(crypto.randomUUID(), userId, purpose, codeHash, targetEmail, expiresAt, now.toISOString());

  return { code, cooldownRemaining: 0, expiresInMinutes: EXPIRY_MINUTES };
}

// Returns { ok: true } or { ok: false, reason: 'not_found' | 'expired' | 'too_many_attempts' | 'incorrect', attemptsRemaining? }
async function verifyOtp(db, { userId, purpose, code }) {
  const now = new Date().toISOString();
  const row = db.prepare(`
    SELECT * FROM otp_codes WHERE user_id = ? AND purpose = ? AND consumed_at IS NULL
    ORDER BY created_at DESC LIMIT 1
  `).get(userId, purpose);
  if (!row) return { ok: false, reason: 'not_found' };
  if (row.expires_at <= now) return { ok: false, reason: 'expired' };
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, reason: 'too_many_attempts' };

  const match = await bcrypt.compare(String(code || ''), row.code_hash);
  if (!match) {
    db.prepare('UPDATE otp_codes SET attempts = attempts + 1 WHERE id = ?').run(row.id);
    const attemptsRemaining = Math.max(MAX_ATTEMPTS - (row.attempts + 1), 0);
    return { ok: false, reason: attemptsRemaining <= 0 ? 'too_many_attempts' : 'incorrect', attemptsRemaining };
  }
  db.prepare('UPDATE otp_codes SET consumed_at = ? WHERE id = ?').run(now, row.id);
  return { ok: true };
}

function otpErrorMessage(reason) {
  switch (reason) {
    case 'expired': return 'That code has expired. Please request a new one.';
    case 'too_many_attempts': return 'Too many incorrect attempts. Please request a new code.';
    case 'incorrect': return 'Incorrect code. Please try again.';
    case 'not_found':
    default: return 'No active code found for this request. Please request a new one.';
  }
}

module.exports = { createOtp, verifyOtp, otpErrorMessage, OTP_LENGTH, EXPIRY_MINUTES, MAX_ATTEMPTS, RESEND_COOLDOWN_SECONDS };
