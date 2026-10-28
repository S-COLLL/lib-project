const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool, tx } = require('../config/db');
const { fail } = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const L = require('../utils/lib');

const sign = (userId) => jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
const validEmail = (e) => /^\S+@\S+\.\S+$/.test(String(e || ''));
const ROLES = ['admin', 'librarian', 'staff', 'student'];

// POST /auth/login  { email | identifier, password } — the identifier may be an email or a numeric user ID
exports.login = asyncHandler(async (req, res) => {
  const ident = String(req.body.email || req.body.identifier || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  if (!ident || !password) fail(400, 'Email (or user ID) and password are required');
  const [rows] = await pool.query(`SELECT * FROM users WHERE ${/^\d+$/.test(ident) ? 'user_id' : 'email'} = ?`, [ident]);
  const u = rows[0];
  if (!u || !(await bcrypt.compare(password, u.password_hash))) fail(401, 'Invalid email or password');
  if (!u.is_active) fail(403, 'This account has been disabled');
  await pool.query('UPDATE users SET last_login = NOW() WHERE user_id = ?', [u.user_id]);
  u.last_login = new Date();
  res.json({ success: true, token: sign(u.user_id), user: await L.userOut(u) });
});

// POST /auth/register — student self-registration; links to an existing member with the same email
exports.register = asyncHandler(async (req, res) => {
  const { name, email, password, phone, department, course, year } = req.body;
  const errors = {};
  if (!String(name || '').trim()) errors.name = 'Name is required';
  if (!validEmail(email)) errors.email = 'Email is invalid';
  if (String(password || '').length < 6) errors.password = 'Password must be at least 6 characters';
  if (Object.keys(errors).length) fail(400, Object.values(errors)[0], errors);
  const mail = email.toLowerCase();

  const userId = await tx(async (c) => {
    const [[exists]] = await c.query('SELECT user_id FROM users WHERE email = ?', [mail]);
    if (exists) fail(409, 'An account with this email already exists');
    const [u] = await c.query(`INSERT INTO users (name, email, password_hash, role, search_history) VALUES (?, ?, ?, 'student', '[]')`, [
      name.trim(),
      mail,
      await bcrypt.hash(password, 10),
    ]);
    let [[m]] = await c.query('SELECT member_id, member_code FROM members WHERE email = ? FOR UPDATE', [mail]);
    if (m) {
      await c.query('UPDATE members SET user_id = ? WHERE member_id = ?', [u.insertId, m.member_id]);
    } else {
      const [ins] = await c.query(
        `INSERT INTO members (user_id, name, email, phone, department, course, year, membership_type, membership_start, membership_expiry)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'Student', NOW(), DATE_ADD(NOW(), INTERVAL 365 DAY))`,
        [u.insertId, name.trim(), mail, phone || null, department || '', course || '', year || '']
      );
      m = { member_id: ins.insertId, member_code: await L.assignCode(c, 'members', 'member_id', 'member_code', 'MEM', 4, ins.insertId) };
    }
    await L.notify(c, { title: 'New member registered', message: `${name.trim()} (${m.member_code}) created an account.`, link: 'members.html' });
    return u.insertId;
  });

  const [[u]] = await pool.query('SELECT * FROM users WHERE user_id = ?', [userId]);
  res.status(201).json({ success: true, token: sign(userId), user: await L.userOut(u) });
});

exports.me = asyncHandler(async (req, res) => {
  res.json({ success: true, user: await L.userOut(req.user) });
});

// PUT /auth/profile  { name, avatar }
exports.updateProfile = asyncHandler(async (req, res) => {
  const { name, avatar } = req.body;
  if (name !== undefined && !String(name).trim()) fail(400, 'Name is required', { name: 'Name is required' });
  await tx(async (c) => {
    if (name !== undefined) await c.query('UPDATE users SET name = ? WHERE user_id = ?', [String(name).trim(), req.user.user_id]);
    if (avatar !== undefined) await c.query('UPDATE users SET avatar = ? WHERE user_id = ?', [avatar || '', req.user.user_id]);
    if (req.user.memberId) {
      if (name !== undefined) await c.query('UPDATE members SET name = ? WHERE member_id = ?', [String(name).trim(), req.user.memberId]);
      if (avatar !== undefined) await c.query('UPDATE members SET profile_photo = ? WHERE member_id = ?', [avatar || '', req.user.memberId]);
    }
  });
  const [[u]] = await pool.query('SELECT * FROM users WHERE user_id = ?', [req.user.user_id]);
  res.json({ success: true, user: await L.userOut(u) });
});

// PATCH /auth/password  { currentPassword, newPassword }
exports.changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!(await bcrypt.compare(String(currentPassword || ''), req.user.password_hash))) {
    fail(400, 'Current password is incorrect', { currentPassword: 'Current password is incorrect' });
  }
  if (String(newPassword || '').length < 6) fail(400, 'New password must be at least 6 characters', { newPassword: 'At least 6 characters' });
  await pool.query('UPDATE users SET password_hash = ? WHERE user_id = ?', [await bcrypt.hash(newPassword, 10), req.user.user_id]);
  res.json({ success: true, message: 'Password updated' });
});

// POST /auth/search-history  { term }
exports.addSearchHistory = asyncHandler(async (req, res) => {
  const term = String(req.body.term || '').trim().slice(0, 60);
  let history = L.parseJson(req.user.search_history, []);
  if (term.length >= 2) {
    history = [term, ...history.filter((t) => t.toLowerCase() !== term.toLowerCase())].slice(0, 20);
    await pool.query('UPDATE users SET search_history = ? WHERE user_id = ?', [JSON.stringify(history), req.user.user_id]);
  }
  res.json({ success: true, searchHistory: history });
});

// GET /auth/users  (admin)
exports.listUsers = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT u.*, m.member_id, m.member_code, m.name AS member_name FROM users u LEFT JOIN members m ON m.user_id = u.user_id ORDER BY u.created_at DESC, u.user_id DESC`
  );
  const data = rows.map((u) => ({
    _id: L.id(u.user_id),
    name: u.name,
    email: u.email,
    role: u.role,
    avatar: u.avatar || '',
    isActive: !!u.is_active,
    lastLogin: u.last_login,
    member: u.member_id ? { _id: L.id(u.member_id), memberId: u.member_code, name: u.member_name } : undefined,
    createdAt: u.created_at,
    updatedAt: u.updated_at,
  }));
  res.json({ success: true, data });
});

// POST /auth/users  (admin)  { name, email, password, role }
exports.createUser = asyncHandler(async (req, res) => {
  const { name, email, password, role } = req.body;
  const errors = {};
  if (!String(name || '').trim()) errors.name = 'Name is required';
  if (!validEmail(email)) errors.email = 'Email is invalid';
  if (String(password || '').length < 6) errors.password = 'Password must be at least 6 characters';
  if (!ROLES.includes(role)) errors.role = 'Role is required';
  if (Object.keys(errors).length) fail(400, Object.values(errors)[0], errors);
  const mail = email.toLowerCase();
  const userId = await tx(async (c) => {
    const [[exists]] = await c.query('SELECT user_id FROM users WHERE email = ?', [mail]);
    if (exists) fail(409, 'An account with this email already exists');
    let member = null;
    if (role === 'student') {
      [[member]] = await c.query('SELECT member_id, user_id FROM members WHERE email = ? FOR UPDATE', [mail]);
      if (!member) fail(400, 'Create the library member first; student accounts must match a member email');
      if (member.user_id) fail(409, 'This member already has a login');
    }
    const [u] = await c.query(`INSERT INTO users (name, email, password_hash, role, search_history) VALUES (?, ?, ?, ?, '[]')`, [
      name.trim(),
      mail,
      await bcrypt.hash(password, 10),
      role,
    ]);
    if (member) await c.query('UPDATE members SET user_id = ? WHERE member_id = ?', [u.insertId, member.member_id]);
    return u.insertId;
  });
  const [[u]] = await pool.query('SELECT * FROM users WHERE user_id = ?', [userId]);
  res.status(201).json({ success: true, data: await L.userOut(u) });
});

// PATCH /auth/users/:id  (admin)  { name, role, isActive, password }
exports.updateUser = asyncHandler(async (req, res) => {
  const target = Number(req.params.id);
  const [[u]] = await pool.query('SELECT * FROM users WHERE user_id = ?', [target]);
  if (!u) fail(404, 'User not found');
  const { name, role, isActive, password } = req.body;
  if (target === req.user.user_id && ((role && role !== u.role) || isActive === false)) {
    fail(400, 'You cannot change your own role or disable your own account');
  }
  if (role !== undefined && !ROLES.includes(role)) fail(400, 'Invalid role');
  if (password !== undefined && String(password).length < 6) fail(400, 'Password must be at least 6 characters');
  await pool.query(
    `UPDATE users SET name = COALESCE(?, name), role = COALESCE(?, role), is_active = COALESCE(?, is_active),
       password_hash = COALESCE(?, password_hash) WHERE user_id = ?`,
    [name ? String(name).trim() : null, role || null, isActive === undefined ? null : isActive ? 1 : 0, password ? await bcrypt.hash(password, 10) : null, target]
  );
  const [[fresh]] = await pool.query('SELECT * FROM users WHERE user_id = ?', [target]);
  res.json({ success: true, data: await L.userOut(fresh) });
});
