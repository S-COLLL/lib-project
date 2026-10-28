const { pool, tx } = require('../config/db');
const { fail } = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const L = require('../utils/lib');

const validEmail = (e) => /^\S+@\S+\.\S+$/.test(String(e || ''));
const MEMBER_TYPES = ['Student', 'Faculty', 'Staff', 'Premium', 'Guest'];

function validateMember(body, partial) {
  const e = {};
  if ((!partial || body.name !== undefined) && String(body.name || '').trim().length < 2) e.name = 'Name must be at least 2 characters';
  if ((!partial || body.email !== undefined) && !validEmail(body.email)) e.email = 'Email is invalid';
  if (body.phone && !/^[+\d][\d\s-]{7,15}$/.test(body.phone)) e.phone = 'Phone number is invalid';
  if (body.neptunCode && !/^[A-Za-z0-9]{6}$/.test(body.neptunCode)) e.neptunCode = 'Neptun code is 6 letters or digits';
  if (body.membershipType && !MEMBER_TYPES.includes(body.membershipType)) e.membershipType = 'Invalid membership type';
  ['membershipStart', 'membershipExpiry'].forEach((k) => {
    if (body[k] && Number.isNaN(new Date(body[k]).getTime())) e[k] = 'Invalid date';
  });
  if (Object.keys(e).length) fail(400, Object.values(e)[0], e);
}

function memberColumns(body) {
  const map = { name: 'name', phone: 'phone', profilePhoto: 'profile_photo', department: 'department', course: 'course', year: 'year', membershipType: 'membership_type', status: 'status' };
  const cols = {};
  Object.entries(map).forEach(([k, col]) => {
    if (body[k] !== undefined) cols[col] = typeof body[k] === 'string' ? body[k].trim() : body[k];
  });
  if (body.email !== undefined) cols.email = String(body.email).trim().toLowerCase();
  if (body.neptunCode !== undefined) cols.neptun_code = body.neptunCode ? String(body.neptunCode).trim().toUpperCase() : null;
  if (body.membershipStart) cols.membership_start = new Date(body.membershipStart);
  if (body.membershipExpiry) cols.membership_expiry = new Date(body.membershipExpiry);
  if (cols.status && !['Active', 'Expired', 'Suspended'].includes(cols.status)) fail(400, 'Invalid status');
  return cols;
}

async function memberPayment(c, user, memberId, reason, amount, method) {
  const [ins] = await c.query(
    `INSERT INTO fine_payments (member_id, reason, amount, payment_date, method, status, reference, received_by) VALUES (?, ?, ?, NOW(), ?, 'Paid', ?, ?)`,
    [memberId, reason, amount, method, `${method.toUpperCase().replace(/\s/g, '')}-${Date.now().toString().slice(-8)}`, user.user_id]
  );
  await L.assignCode(c, 'fine_payments', 'payment_id', 'payment_code', 'PAY', 5, ins.insertId);
  await L.assignNextCode(c, 'fine_payments', 'payment_id', 'receipt_no', 'RCPT-', 6, ins.insertId);
  return L.paymentOut((await c.query(`${L.PAYMENT_SQL} WHERE p.payment_id = ?`, [ins.insertId]))[0][0]);
}

const SORTS = { name: 'm.name ASC', fine: 'pending_fine DESC', expiry: 'm.membership_expiry ASC' };

exports.listMembers = asyncHandler(async (req, res) => {
  const q = req.query;
  const where = [];
  const params = [];
  if (q.search) {
    const like = `%${q.search}%`;
    where.push('(m.name LIKE ? OR m.email LIKE ? OR m.member_code LIKE ? OR m.phone LIKE ? OR m.department LIKE ? OR m.course LIKE ? OR m.neptun_code LIKE ?)');
    params.push(like, like, like, like, like, like, like);
  }
  if (q.status) {
    where.push('m.status = ?');
    params.push(q.status);
  }
  if (q.type) {
    where.push('m.membership_type = ?');
    params.push(q.type);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const pg = L.paginate(q, 12, 500);
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM members m ${w}`, params);
  const [rows] = await pool.query(`${L.MEMBER_SQL} ${w} ORDER BY ${SORTS[q.sort] || 'm.created_at DESC, m.member_id DESC'} LIMIT ? OFFSET ?`, [...params, pg.limit, pg.offset]);
  res.json({ success: true, data: rows.map(L.memberOut), pagination: L.pageInfo(pg, total) });
});

exports.getMember = asyncHandler(async (req, res) => {
  const m = await L.findMemberRow(pool, req.params.id);
  if (req.user.role === 'student' && req.user.memberId !== m.member_id) fail(403, 'You can only view your own membership');
  const [issues] = await pool.query(
    `${L.LOAN_SQL.replace('SELECT l.*,', 'SELECT l.*, b.cover_image, b.isbn, a.name AS author_name,').replace('JOIN books b ON b.book_id = l.book_id', 'JOIN books b ON b.book_id = l.book_id JOIN authors a ON a.author_id = b.author_id')}
     WHERE l.member_id = ? ORDER BY l.issue_date DESC`,
    [m.member_id]
  );
  const [fines] = await pool.query(`${L.FINE_SQL} WHERE f.member_id = ? ORDER BY f.created_at DESC`, [m.member_id]);
  const [payments] = await pool.query(`${L.PAYMENT_SQL} WHERE p.member_id = ? ORDER BY p.payment_date DESC`, [m.member_id]);
  const [reservations] = await pool.query(
    `SELECT r.*, b.book_code, b.title FROM reservations r JOIN books b ON b.book_id = r.book_id WHERE r.member_id = ? ORDER BY r.reservation_date DESC`,
    [m.member_id]
  );
  res.json({
    success: true,
    data: L.memberOut(m),
    issues: issues.map((i) => ({
      ...L.issueOut(i),
      book: { _id: L.id(i.book_id), bookId: i.book_code, title: i.book_title, coverImage: i.cover_image || '', isbn: i.isbn, authorName: i.author_name },
    })),
    fines: fines.map(L.fineOut),
    payments: payments.map(L.paymentOut),
    reservations: reservations.map((r) => ({ ...L.reservationOut(r), book: { _id: L.id(r.book_id), bookId: r.book_code, title: r.title } })),
  });
});

exports.createMember = asyncHandler(async (req, res) => {
  const body = req.body;
  validateMember(body, false);
  const data = await tx(async (c) => {
    const s = await L.getSettings(c);
    const cols = { membership_type: 'Student', status: 'Active', ...memberColumns(body) };
    cols.membership_start = cols.membership_start || new Date();
    cols.membership_expiry = cols.membership_expiry || L.addDays(cols.membership_start, 365);
    if (cols.membership_expiry <= cols.membership_start) fail(400, 'Expiry date must be after the start date', { membershipExpiry: 'Must be after the start date' });
    const [[linkedUser]] = await c.query(`SELECT user_id FROM users WHERE email = ? AND role = 'student'`, [cols.email]);
    if (linkedUser) cols.user_id = linkedUser.user_id;
    const keys = Object.keys(cols);
    const [ins] = await c.query(`INSERT INTO members (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, keys.map((k) => cols[k]));
    const memberCode = await L.assignCode(c, 'members', 'member_id', 'member_code', 'MEM', 4, ins.insertId);
    if (body.collectFee) await memberPayment(c, req.user, ins.insertId, 'Membership Fee', Number(body.feeAmount) || s.membershipFee, body.feeMethod || 'Cash');
    await L.notify(c, { title: 'New member added', message: `${cols.name} (${memberCode}) joined as ${cols.membership_type}.`, link: 'members.html' });
    return L.memberOut((await c.query(`${L.MEMBER_SQL} WHERE m.member_id = ?`, [ins.insertId]))[0][0]);
  });
  res.status(201).json({ success: true, data });
});

exports.updateMember = asyncHandler(async (req, res) => {
  const body = req.body;
  validateMember(body, true);
  const data = await tx(async (c) => {
    const m = await L.findMemberRow(c, req.params.id);
    const cols = memberColumns(body);
    const start = cols.membership_start || m.membership_start;
    const expiry = cols.membership_expiry || m.membership_expiry;
    if (new Date(expiry) <= new Date(start)) fail(400, 'Expiry date must be after the start date', { membershipExpiry: 'Must be after the start date' });
    if (cols.membership_expiry && cols.membership_expiry > new Date()) {
      cols.expiry_notified = 0;
      if (m.status === 'Expired' && !body.status) cols.status = 'Active';
    }
    const keys = Object.keys(cols);
    if (keys.length) await c.query(`UPDATE members SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE member_id = ?`, [...keys.map((k) => cols[k]), m.member_id]);
    if (m.user_id && (cols.name || cols.email)) {
      await c.query('UPDATE users SET name = COALESCE(?, name), email = COALESCE(?, email) WHERE user_id = ?', [cols.name || null, cols.email || null, m.user_id]);
    }
    return L.memberOut((await c.query(`${L.MEMBER_SQL} WHERE m.member_id = ?`, [m.member_id]))[0][0]);
  });
  res.json({ success: true, data });
});

// PATCH /members/:id/renew  { months, collectFee, amount, method }
exports.renewMember = asyncHandler(async (req, res) => {
  const result = await tx(async (c) => {
    const s = await L.getSettings(c);
    const m = await L.findMemberRow(c, req.params.id);
    const months = Math.min(60, Math.max(1, Number(req.body.months) || 12));
    const base = new Date(m.membership_expiry) > new Date() ? new Date(m.membership_expiry) : new Date();
    base.setMonth(base.getMonth() + months);
    await c.query(`UPDATE members SET membership_expiry = ?, expiry_notified = 0, status = IF(status = 'Expired', 'Active', status) WHERE member_id = ?`, [base, m.member_id]);
    const payment =
      req.body.collectFee !== false
        ? await memberPayment(c, req.user, m.member_id, `Membership Renewal (${months} months)`, Number(req.body.amount) || Math.round((s.membershipFee * months) / 12), req.body.method || 'Cash')
        : null;
    await L.notify(c, { audience: 'member', memberId: m.member_id, type: 'membership', title: 'Membership renewed', message: `Your membership is valid until ${base.toDateString()}.` });
    const fresh = L.memberOut((await c.query(`${L.MEMBER_SQL} WHERE m.member_id = ?`, [m.member_id]))[0][0]);
    return { data: fresh, payment };
  });
  res.json({ success: true, ...result });
});

// Members with loan/fine/payment history are kept for the audit trail and suspended instead of deleted.
exports.deleteMember = asyncHandler(async (req, res) => {
  const message = await tx(async (c) => {
    const m = await L.findMemberRow(c, req.params.id);
    if (m.books_issued > 0) fail(400, `Member has ${m.books_issued} book(s) still issued. Collect them before deleting.`);
    if (m.pending_fine > 0) fail(400, `Member has ${L.money(m.pending_fine)} pending fines. Settle or waive them first.`);
    const [[{ history }]] = await c.query(
      `SELECT (SELECT COUNT(*) FROM loans WHERE member_id = ?) + (SELECT COUNT(*) FROM fines WHERE member_id = ?)
            + (SELECT COUNT(*) FROM fine_payments WHERE member_id = ?) AS history`,
      [m.member_id, m.member_id, m.member_id]
    );
    if (m.user_id) await c.query('UPDATE users SET is_active = 0 WHERE user_id = ?', [m.user_id]);
    if (history) {
      await c.query(`UPDATE members SET status = 'Suspended' WHERE member_id = ?`, [m.member_id]);
      await c.query(`UPDATE reservations SET status = 'Cancelled' WHERE member_id = ? AND status IN ('Waiting','Available')`, [m.member_id]);
      return `${m.name} has loan or payment history, so the membership was suspended instead of deleted`;
    }
    await c.query('DELETE FROM members WHERE member_id = ?', [m.member_id]);
    return 'Member deleted';
  });
  res.json({ success: true, message });
});
