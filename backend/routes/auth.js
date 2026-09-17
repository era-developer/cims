const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { serializeUser, findUserByLogin, findUserById, createUser, updateUser } = require('../utils/usersDb');
const { logActivity } = require('../utils/logsDb');
const { getCenterById } = require('../utils/centers');
const { authMiddleware } = require('../middleware/auth');
const { getDb } = require('../utils/db');
const { createOtp, verifyOtp, otpErrorMessage } = require('../utils/otp');
const { sendOtpEmail, sendRegistrationSubmitted, sendPasswordChanged } = require('../utils/email');

const router = express.Router();

router.post('/register', async (req, res) => {
  try {
    const payload = {
      username: String(req.body.username || '').trim(),
      fullName: String(req.body.fullName || '').trim(),
      email: String(req.body.email || '').trim(),
      mobile: String(req.body.mobile || '').trim(),
      altMobile: String(req.body.altMobile || '').trim(),
      college: String(req.body.college || '').trim(),
      graduationYear: String(req.body.graduationYear || '').trim(),
      degree: String(req.body.degree || req.body.stream || '').trim(),
      department: String(req.body.department || '').trim(),
      centerId: String(req.body.centerId || '').trim(),
      password: String(req.body.password || ''),
      role: 'student',
      active: false,
      source: 'self',
    };

    if (!payload.username || !payload.fullName || !payload.email || !payload.password || !payload.mobile || !payload.college || !payload.centerId) {
      return res.status(400).json({ message: 'Username, full name, email, password, mobile, college, and center are required' });
    }
    if (!getCenterById(payload.centerId)) return res.status(400).json({ message: 'Invalid center selected' });

    const created = await createUser(payload);
    await logActivity('REGISTER_REQUEST', payload.username, {
      role: 'student', centerId: payload.centerId, info: 'Student self-registration submitted for admin approval',
    });
    // Fire-and-forget: the registration is saved regardless of mail delivery.
    sendRegistrationSubmitted({
      user: created || payload,
      centerId: payload.centerId,
      centerName: getCenterById(payload.centerId)?.name || '',
    }).catch(err => console.error('[email] registration notice failed:', err.message));

    res.status(201).json({
      message: 'Registration submitted successfully. Please wait for admin approval before signing in.',
    });
  } catch (err) {
    console.error(err);
    res.status(400).json({ message: err.message || 'Unable to register right now' });
  }
});

router.post('/login', async (req, res) => {
  try {
    const loginId = String(req.body.username || req.body.login || '').trim();
    const password = String(req.body.password || '');
    if (!loginId || !password) return res.status(400).json({ message: 'Username/email and password required' });

    const user = findUserByLogin(loginId);
    if (!user) return res.status(401).json({ message: 'Invalid credentials' });
    if (!user.active) {
      const approvalMessage = user.source === 'self'
        ? 'Your registration is awaiting admin approval.'
        : 'Account disabled. Contact admin.';
      return res.status(403).json({ message: approvalMessage });
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) return res.status(401).json({ message: 'Invalid credentials' });

    const token = jwt.sign(
      {
        id: user.id,
        username: user.username,
        role: user.role,
        fullName: user.fullName,
        centerId: user.centerId || '',
        centerName: user.centerName || '',
      },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    await logActivity('LOGIN', user.username, { role: user.role, centerId: user.centerId, info: 'Logged in successfully' });
    res.json({
      token,
      user: serializeUser(user),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

// Always returns the same generic message whether or not the account/email
// actually exists -- otherwise this endpoint would let anyone probe for
// valid usernames/emails by watching which ones get a different response.
const FORGOT_PASSWORD_GENERIC_MESSAGE = 'If an account with that username or email exists and has an email on file, a verification code has been sent to it.';

router.post('/forgot-password', async (req, res) => {
  try {
    const loginId = String(req.body.loginId || req.body.username || '').trim();
    if (!loginId) return res.status(400).json({ message: 'Enter your username or email.' });

    const user = findUserByLogin(loginId);
    if (user && user.active && user.email) {
      const db = getDb();
      const { code, expiresInMinutes } = await createOtp(db, { userId: user.id, purpose: 'password_reset', targetEmail: user.email });
      // A null code means a still-valid code from a recent request already
      // exists -- nothing new to send, the earlier email already has a
      // working code. Still respond with the same generic message either way.
      if (code) {
        await sendOtpEmail({ targetEmail: user.email, centerId: user.centerId, code, purpose: 'password_reset', expiresInMinutes });
        await logActivity('PASSWORD_RESET_REQUESTED', user.username, { role: user.role, centerId: user.centerId, info: 'Password reset code requested' });
      }
    }
    res.json({ message: FORGOT_PASSWORD_GENERIC_MESSAGE });
  } catch (err) {
    console.error(err);
    res.json({ message: FORGOT_PASSWORD_GENERIC_MESSAGE }); // never leak internal errors on this endpoint either
  }
});

router.post('/reset-password', async (req, res) => {
  try {
    const loginId = String(req.body.loginId || req.body.username || '').trim();
    const code = String(req.body.code || '').trim();
    const newPassword = String(req.body.newPassword || '');
    if (!loginId || !code || !newPassword) {
      return res.status(400).json({ message: 'Username/email, code, and new password are required.' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ message: 'New password must be at least 8 characters.' });
    }

    const user = findUserByLogin(loginId);
    // Same code-verification failure message whether the account doesn't
    // exist or the code is simply wrong -- avoids re-opening the account
    // -enumeration hole that the generic message on /forgot-password closes.
    if (!user) return res.status(400).json({ message: 'Invalid or expired code.' });

    const db = getDb();
    const result = await verifyOtp(db, { userId: user.id, purpose: 'password_reset', code });
    if (!result.ok) return res.status(400).json({ message: otpErrorMessage(result.reason) });

    await updateUser(user.id, { password: newPassword });
    await logActivity('PASSWORD_RESET', user.username, { role: user.role, centerId: user.centerId, info: 'Password reset via emailed code' });
    sendPasswordChanged({ user, centerId: user.centerId, method: 'reset' })
      .catch(err => console.error('[email] password-reset notice failed:', err.message));

    res.json({ message: 'Password reset successfully. You can now sign in with your new password.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Unable to reset password right now.' });
  }
});

router.get('/profile', authMiddleware, async (req, res) => {
  try {
    const user = findUserById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ user: serializeUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Unable to load profile' });
  }
});

router.put('/profile', authMiddleware, async (req, res) => {
  try {
    const user = findUserById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });

    const updates = {
      fullName: req.body.fullName !== undefined ? String(req.body.fullName || '').trim() : undefined,
      email: req.body.email !== undefined ? String(req.body.email || '').trim() : undefined,
      mobile: req.body.mobile !== undefined ? String(req.body.mobile || '').trim() : undefined,
      altMobile: req.body.altMobile !== undefined ? String(req.body.altMobile || '').trim() : undefined,
      college: req.body.college !== undefined ? String(req.body.college || '').trim() : undefined,
      graduationYear: req.body.graduationYear !== undefined ? String(req.body.graduationYear || '').trim() : undefined,
      degree: req.body.degree !== undefined ? String(req.body.degree || '').trim() : undefined,
      department: req.body.department !== undefined ? String(req.body.department || '').trim() : undefined,
    };

    const updated = await updateUser(req.user.id, updates);
    await logActivity('UPDATE_PROFILE', req.user.username, {
      role: req.user.role, centerId: user.centerId, info: 'Student profile updated from checkout/profile flow',
    });
    res.json({ message: 'Profile updated', user: serializeUser(updated) });
  } catch (err) {
    console.error(err);
    res.status(400).json({ message: err.message || 'Unable to update profile' });
  }
});

// Lets any signed-in user change their own password. Admins had no way to do
// this before -- My Profile is student-only, and the Users page reset is a
// super-admin tool -- which is how a seed-time password ends up living for
// months. Requires the current password so a walked-away session cannot be
// used to lock the real owner out.
router.post('/change-password', authMiddleware, async (req, res) => {
  try {
    const currentPassword = String(req.body.currentPassword || '');
    const newPassword = String(req.body.newPassword || '');

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: 'Current and new password are required.' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ message: 'New password must be at least 8 characters.' });
    }
    if (newPassword === currentPassword) {
      return res.status(400).json({ message: 'New password must be different from the current one.' });
    }

    const user = findUserById(req.user.id);
    if (!user || !user.active) return res.status(401).json({ message: 'Invalid session' });

    const match = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!match) return res.status(401).json({ message: 'Current password is incorrect.' });

    await updateUser(user.id, { password: newPassword });
    await logActivity('PASSWORD_CHANGED', user.username, {
      role: user.role, centerId: user.centerId, info: 'Password changed by the user',
    });
    sendPasswordChanged({ user, centerId: user.centerId, method: 'changed' })
      .catch(err => console.error('[email] password-change notice failed:', err.message));
    res.json({ message: 'Password changed. Use the new password next time you sign in.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Unable to change password right now.' });
  }
});

module.exports = router;
