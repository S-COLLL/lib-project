const fs = require('fs');
const path = require('path');
const { pool } = require('../config/db');
const { fail } = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const L = require('../utils/lib');

/* ============================== Notifications ============================== */

/** Notifications a user may see: everyone's, staff-wide (for staff) and their own member ones. */
function visibleWhere(user) {
  const parts = [`n.audience = 'all'`];
  const params = [];
  if (L.isStaff(user)) parts.push(`n.audience = 'staff'`);
  if (user.memberId) {
    parts.push(`(n.audience = 'member' AND n.member_id = ?)`);
    params.push(user.memberId);
  }
  return { sql: `(${parts.join(' OR ')})`, params };
}

async function unreadCount(user) {
  const v = visibleWhere(user);
  const [[{ n }]] = await pool.query(
    `SELECT COUNT(*) AS n FROM notifications n
     WHERE ${v.sql} AND NOT EXISTS (SELECT 1 FROM notification_reads r WHERE r.notification_id = n.notification_id AND r.user_id = ?)`,
    [...v.params, user.user_id]
  );
  return Number(n);
}

exports.listNotifications = asyncHandler(async (req, res) => {
  const user = req.user;
  const v = visibleWhere(user);
  const where = [v.sql];
  const params = [...v.params];
  if (req.query.type) {
    where.push('n.type = ?');
    params.push(req.query.type);
  }
  if (req.query.unread === 'true') {
    where.push('r.user_id IS NULL');
  }
  const from = `FROM notifications n LEFT JOIN notification_reads r ON r.notification_id = n.notification_id AND r.user_id = ?`;
  const pg = L.paginate(req.query, 20, 100);
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${from} WHERE ${where.join(' AND ')}`, [user.user_id, ...params]);
  const [rows] = await pool.query(
    `SELECT n.*, r.user_id AS read_by ${from} WHERE ${where.join(' AND ')} ORDER BY n.created_at DESC, n.notification_id DESC LIMIT ? OFFSET ?`,
    [user.user_id, ...params, pg.limit, pg.offset]
  );
  res.json({
    success: true,
    data: rows.map((n) => ({
      _id: L.id(n.notification_id),
      audience: n.audience,
      member: L.id(n.member_id),
      type: n.type,
      title: n.title,
      message: n.message,
      link: n.link,
      read: !!n.read_by,
      createdAt: n.created_at,
      updatedAt: n.updated_at,
    })),
    unread: await unreadCount(user),
    pagination: L.pageInfo(pg, total),
  });
});

exports.unread = asyncHandler(async (req, res) => {
  res.json({ success: true, unread: await unreadCount(req.user) });
});

exports.readAll = asyncHandler(async (req, res) => {
  const v = visibleWhere(req.user);
  const [r] = await pool.query(
    `INSERT IGNORE INTO notification_reads (notification_id, user_id) SELECT n.notification_id, ? FROM notifications n WHERE ${v.sql}`,
    [req.user.user_id, ...v.params]
  );
  res.json({ success: true, updated: r.affectedRows });
});

exports.readOne = asyncHandler(async (req, res) => {
  const v = visibleWhere(req.user);
  const [[n]] = await pool.query(`SELECT n.notification_id FROM notifications n WHERE n.notification_id = ? AND ${v.sql}`, [Number(req.params.id), ...v.params]);
  if (!n) fail(404, 'Notification not found');
  await pool.query('INSERT IGNORE INTO notification_reads (notification_id, user_id) VALUES (?, ?)', [n.notification_id, req.user.user_id]);
  res.json({ success: true });
});

// POST /notifications  { audience, member, title, message, link } — staff broadcast
exports.broadcast = asyncHandler(async (req, res) => {
  const { audience = 'all', member, title, message, link = '' } = req.body;
  const errors = {};
  if (!String(title || '').trim()) errors.title = 'Title is required';
  if (!String(message || '').trim()) errors.message = 'Message is required';
  if (!['all', 'staff', 'member'].includes(audience)) errors.audience = 'Invalid audience';
  if (Object.keys(errors).length) fail(400, Object.values(errors)[0], errors);
  const memberId = audience === 'member' ? (await L.findMemberRow(pool, member)).member_id : null;
  await L.notify(pool, { audience, memberId, type: 'system', title, message, link });
  const [[n]] = await pool.query('SELECT * FROM notifications ORDER BY notification_id DESC LIMIT 1');
  res.status(201).json({
    success: true,
    data: { _id: L.id(n.notification_id), audience: n.audience, member: L.id(n.member_id), type: n.type, title: n.title, message: n.message, link: n.link, createdAt: n.created_at },
  });
});

exports.deleteNotification = asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM notifications WHERE notification_id = ?', [Number(req.params.id)]);
  res.json({ success: true, message: 'Notification deleted' });
});

/* ================================ Settings ================================ */

exports.getSettings = asyncHandler(async (req, res) => {
  res.json({ success: true, data: await L.getSettings() });
});

// PUT /settings  — admin only; only known keys, numeric ones must be non-negative
exports.updateSettings = asyncHandler(async (req, res) => {
  const entries = Object.entries(req.body || {}).filter(([k]) => k in L.SETTING_DEFAULTS);
  if (!entries.length) fail(400, 'No settings to update');
  const errors = {};
  entries.forEach(([k, v]) => {
    if (L.TEXT_SETTINGS.includes(k)) {
      if (!String(v).trim()) errors[k] = 'Required';
    } else if (v === '' || Number.isNaN(Number(v)) || Number(v) < 0) errors[k] = 'Must be a positive number';
  });
  if (['loanDays', 'maxBooksPerMember', 'reservationHoldDays'].some((k) => entries.find(([key, v]) => key === k && Number(v) < 1))) {
    errors.loanDays = errors.loanDays || 'Must be at least 1';
  }
  if (Object.keys(errors).length) fail(400, `${Object.keys(errors)[0]}: ${Object.values(errors)[0]}`, errors);
  for (const [k, v] of entries) {
    await pool.query('INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)', [k, String(v).trim()]);
  }
  res.json({ success: true, data: await L.getSettings(), message: 'Settings saved' });
});

// POST /settings/backup  — admin only; JSON dump of every table into backupPath
exports.backup = asyncHandler(async (req, res) => {
  const s = await L.getSettings();
  const dir = path.resolve(process.cwd(), s.backupPath);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    fail(400, `Cannot create the backup folder "${s.backupPath}"`);
  }
  const tables = ['users', 'members', 'authors', 'categories', 'shelves', 'books', 'loans', 'reservations', 'fines', 'fine_payments', 'notifications', 'notification_reads', 'settings'];
  const dump = { createdAt: new Date().toISOString(), database: process.env.MYSQL_DATABASE || 'library_app', tables: {} };
  for (const t of tables) {
    const [rows] = await pool.query(`SELECT * FROM ${t}`);
    dump.tables[t] = rows;
  }
  const file = path.join(dir, `library-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(file, JSON.stringify(dump, null, 2));
  const rows = Object.values(dump.tables).reduce((t, r) => t + r.length, 0);
  res.status(201).json({ success: true, data: { file, tables: tables.length, rows }, message: `Backup written to ${file}` });
});
