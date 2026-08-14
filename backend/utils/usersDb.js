// SQLite-backed user store, replacing the old per-center users.xlsx files.
// Shared by auth.js (login/register/profile) and admin.js (user management)
// so there's exactly one place that knows the users table's shape.
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { getDb } = require('./db');
const { getCenterById, requireCenter } = require('./centers');

function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    fullName: row.full_name,
    email: row.email || '',
    mobile: row.mobile || '',
    altMobile: row.alt_mobile || '',
    college: row.college || '',
    graduationYear: row.graduation_year || '',
    degree: row.degree || '',
    department: row.department || '',
    centerId: row.center_id || '',
    centerName: row.center_id ? (getCenterById(row.center_id)?.name || '') : 'All Centers',
    source: row.source,
    active: !!row.active,
    createdAt: row.created_at,
    passwordHash: row.password_hash,
  };
}

// Public shape -- never leaks passwordHash.
function serializeUser(user) {
  if (!user) return null;
  const { passwordHash, ...rest } = user;
  return rest;
}

function findUserByLogin(loginId) {
  const needle = String(loginId || '').trim().toLowerCase();
  if (!needle) return null;
  const db = getDb();
  return rowToUser(db.prepare('SELECT * FROM users WHERE LOWER(username) = ? OR LOWER(email) = ?').get(needle, needle));
}

function findUserById(id) {
  if (!id) return null;
  const db = getDb();
  return rowToUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
}

function listUsers({ centerId } = {}) {
  const db = getDb();
  const rows = centerId
    ? db.prepare('SELECT * FROM users WHERE center_id = ? ORDER BY created_at DESC').all(centerId)
    : db.prepare('SELECT * FROM users ORDER BY created_at DESC').all();
  return rows.map(rowToUser);
}

async function createUser(userData) {
  const db = getDb();
  const role = userData.role || 'student';
  const centerId = role === 'super_admin' ? '' : String(userData.centerId || '').trim();
  const username = String(userData.username || '').trim();
  const fullName = String(userData.fullName || '').trim();
  const password = String(userData.password || '');

  if (!username || !fullName || !password) throw new Error('Username, full name and password are required');
  if (role !== 'super_admin' && !centerId) throw new Error('Center is required');
  if (centerId) requireCenter(centerId);

  if (findUserByLogin(username)) throw new Error('Username already exists');

  const id = crypto.randomUUID();
  const passwordHash = await bcrypt.hash(password, 10);
  db.prepare(`
    INSERT INTO users
      (id, center_id, username, password_hash, full_name, email, mobile, alt_mobile, college,
       graduation_year, degree, department, role, active, created_at, source)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, centerId || null, username, passwordHash, fullName,
    String(userData.email || '').trim(), String(userData.mobile || '').trim(), String(userData.altMobile || '').trim(),
    String(userData.college || '').trim(), String(userData.graduationYear || '').trim(),
    String(userData.degree || userData.stream || '').trim(), String(userData.department || '').trim(),
    role, userData.active === undefined ? 1 : (userData.active ? 1 : 0),
    new Date().toISOString(), userData.source || 'manual',
  );
  return findUserById(id);
}

async function updateUser(userId, userData) {
  const target = findUserById(userId);
  if (!target) throw new Error('User not found');
  const db = getDb();

  const nextRole = userData.role !== undefined ? userData.role : target.role;
  const nextCenterId = nextRole === 'super_admin'
    ? ''
    : (userData.centerId !== undefined ? String(userData.centerId || '').trim() : target.centerId);
  if (nextRole !== 'super_admin' && !nextCenterId) throw new Error('Center is required');
  if (nextCenterId) requireCenter(nextCenterId);

  const username = userData.username !== undefined ? String(userData.username || '').trim() : target.username;
  const fullName = userData.fullName !== undefined ? String(userData.fullName || '').trim() : target.fullName;
  if (!username || !fullName) throw new Error('Username and full name are required');

  const existing = findUserByLogin(username);
  if (existing && existing.id !== userId) throw new Error('Username already exists');

  const nextPasswordHash = userData.password ? await bcrypt.hash(String(userData.password), 10) : target.passwordHash;

  db.prepare(`
    UPDATE users SET center_id = ?, username = ?, full_name = ?, email = ?, mobile = ?, alt_mobile = ?,
      college = ?, graduation_year = ?, degree = ?, department = ?, role = ?, active = ?, source = ?,
      password_hash = ?
    WHERE id = ?
  `).run(
    nextCenterId || null, username, fullName,
    userData.email !== undefined ? String(userData.email || '').trim() : target.email,
    userData.mobile !== undefined ? String(userData.mobile || '').trim() : target.mobile,
    userData.altMobile !== undefined ? String(userData.altMobile || '').trim() : target.altMobile,
    userData.college !== undefined ? String(userData.college || '').trim() : target.college,
    userData.graduationYear !== undefined ? String(userData.graduationYear || '').trim() : target.graduationYear,
    userData.degree !== undefined ? String(userData.degree || '').trim() : target.degree,
    userData.department !== undefined ? String(userData.department || '').trim() : target.department,
    nextRole,
    userData.active !== undefined ? (userData.active ? 1 : 0) : (target.active ? 1 : 0),
    userData.source !== undefined ? userData.source : target.source,
    nextPasswordHash,
    userId,
  );
  return findUserById(userId);
}

function deleteUser(userId) {
  const db = getDb();
  const result = db.prepare('DELETE FROM users WHERE id = ?').run(userId);
  return result.changes > 0;
}

module.exports = {
  serializeUser, findUserByLogin, findUserById, listUsers, createUser, updateUser, deleteUser,
};
