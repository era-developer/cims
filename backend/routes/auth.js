const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { addUser, findUser, findUserById, updateUser, logActivity } = require('../utils/excel');
const { authMiddleware } = require('../middleware/auth');

const router = express.Router();

function serializeUser(user) {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    fullName: user.fullName,
    email: user.email,
    mobile: user.mobile || '',
    altMobile: user.altMobile || '',
    college: user.college || '',
    graduationYear: user.graduationYear || '',
    degree: user.degree || '',
    department: user.department || '',
    source: user.source,
    active: user.active,
  };
}

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
      password: String(req.body.password || ''),
      role: 'student',
      active: false,
      source: 'self',
    };

    if (!payload.username || !payload.fullName || !payload.email || !payload.password || !payload.mobile || !payload.college) {
      return res.status(400).json({ message: 'Username, full name, email, password, mobile, and college are required' });
    }

    await addUser(payload);
    await logActivity('REGISTER_REQUEST', payload.username, {
      role: 'student',
      info: 'Student self-registration submitted for admin approval',
    });

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

    const user = await findUser(loginId);
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
      { id: user.id, username: user.username, role: user.role, fullName: user.fullName },
      process.env.JWT_SECRET || 'cims_secret',
      { expiresIn: '8h' }
    );

    await logActivity('LOGIN', user.username, { role: user.role, info: 'Logged in successfully' });
    res.json({
      token,
      user: serializeUser(user),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Server error' });
  }
});

router.get('/profile', authMiddleware, async (req, res) => {
  try {
    const user = await findUserById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    res.json({ user: serializeUser(user) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Unable to load profile' });
  }
});

router.put('/profile', authMiddleware, async (req, res) => {
  try {
    const user = await findUserById(req.user.id);
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
      role: req.user.role,
      info: 'Student profile updated from checkout/profile flow',
    });
    res.json({ message: 'Profile updated', user: serializeUser(updated) });
  } catch (err) {
    console.error(err);
    res.status(400).json({ message: err.message || 'Unable to update profile' });
  }
});

module.exports = router;
