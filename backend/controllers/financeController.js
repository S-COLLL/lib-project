const crypto = require('crypto');
const { pool, tx } = require('../config/db');
const { fail } = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const L = require('../utils/lib');

const METHODS = ['Cash', 'UPI', 'Card', 'Bank Transfer'];

async function findFine(db, user, ref, lock = false) {
  const r = String(ref || '').trim();
  const [[f]] = await db.query(`${L.FINE_SQL} WHERE ${L.isPk(r) ? 'f.fine_id' : 'f.fine_code'} = ? ${lock ? 'FOR UPDATE' : ''}`, [L.isPk(r) ? Number(r) : r.toUpperCase()]);
  if (!f || (user.role === 'student' && f.member_id !== user.memberId)) fail(404, 'Fine not found');
  return f;
}

async function findPayment(db, user, ref) {
  const r = String(ref || '').trim();
  const [[p]] = await db.query(`${L.PAYMENT_SQL} WHERE ${L.isPk(r) ? 'p.payment_id = ?' : '(p.payment_code = ? OR p.receipt_no = ?)'}`, L.isPk(r) ? [Number(r)] : [r.toUpperCase(), r.toUpperCase()]);
  if (!p || (user.role === 'student' && p.member_id !== user.memberId)) fail(404, 'Payment not found');
  return p;
}

/* ================================== Fines ================================== */

exports.listFines = asyncHandler(async (req, res) => {
  const q = req.query;
  const where = [];
  const params = [];
  if (req.user.role === 'student') {
    where.push('f.member_id = ?');
    params.push(req.user.memberId || -1);
  }
  if (q.status) {
    if (q.status === 'Outstanding') where.push(`f.status IN ('Pending','Partially Paid')`);
    else {
      where.push('f.status = ?');
      params.push(q.status);
    }
  }
  if (q.type) {
    where.push('f.type = ?');
    params.push(q.type);
  }
  if (q.member) {
    where.push('f.member_id = ?');
    params.push((await L.findMemberRow(pool, q.member)).member_id);
  }
  if (q.search) {
    const like = `%${q.search}%`;
    where.push('(f.fine_code LIKE ? OR l.transaction_id LIKE ? OR f.transaction_ref LIKE ? OR f.description LIKE ? OR m.name LIKE ? OR m.member_code LIKE ?)');
    params.push(like, like, like, like, like, like);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const pg = L.paginate(q, 15, 500);
  const from = 'FROM fines f LEFT JOIN loans l ON l.loan_id = f.loan_id JOIN members m ON m.member_id = f.member_id LEFT JOIN books b ON b.book_id = f.book_id';
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${from} ${w}`, params);
  const [rows] = await pool.query(
    `SELECT f.*, l.transaction_id AS loan_txn, m.member_code, m.name AS member_name, m.email AS member_email, b.book_code, b.title AS book_title, b.price AS book_price
     ${from} ${w} ORDER BY f.created_at DESC, f.fine_id DESC LIMIT ? OFFSET ?`,
    [...params, pg.limit, pg.offset]
  );
  const data = rows.map((r) => ({
    ...L.fineOut(r),
    member: { _id: L.id(r.member_id), memberId: r.member_code, name: r.member_name, email: r.member_email },
    book: r.book_id ? { _id: L.id(r.book_id), bookId: r.book_code, title: r.book_title, price: r.book_price } : null,
  }));
  res.json({ success: true, data, pagination: L.pageInfo(pg, total) });
});

exports.fineSummary = asyncHandler(async (req, res) => {
  const s = await L.getSettings();
  const scoped = req.user.role === 'student';
  const w = scoped ? 'WHERE member_id = ?' : '';
  const p = scoped ? [req.user.memberId || -1] : [];
  const [[t]] = await pool.query(
    `SELECT COALESCE(SUM(original_amount),0) AS original, COALESCE(SUM(discount),0) AS discount, COALESCE(SUM(paid_amount),0) AS paid,
            COALESCE(SUM(waived_amount),0) AS waived, COUNT(*) AS count, SUM(status IN ('Pending','Partially Paid')) AS pending_count
     FROM fines ${w}`,
    p
  );
  const [byType] = await pool.query(`SELECT type AS _id, SUM(original_amount) AS amount, COUNT(*) AS count FROM fines ${w} GROUP BY type ORDER BY amount DESC`, p);
  res.json({
    success: true,
    data: {
      original: L.round2(t.original),
      discount: L.round2(t.discount),
      paid: L.round2(t.paid),
      waived: L.round2(t.waived),
      count: Number(t.count),
      pendingCount: Number(t.pending_count || 0),
      remaining: L.round2(t.original - t.discount - t.paid - t.waived),
      byType: byType.map((x) => ({ _id: x._id, amount: L.round2(x.amount), count: Number(x.count) })),
      finePerDay: s.finePerDay,
      currency: '₹',
    },
  });
});

// POST /fines  { member, type, amount, description, transactionId }  — manual charge
exports.createFine = asyncHandler(async (req, res) => {
  const { member, type, amount, description = '', transactionId } = req.body;
  const errors = {};
  if (!member) errors.member = 'Member is required';
  if (!type) errors.type = 'Type is required';
  if (!(Number(amount) >= 1)) errors.amount = 'Amount must be at least 1';
  if (Object.keys(errors).length) fail(400, Object.values(errors)[0], errors);
  const data = await tx(async (c) => {
    const m = await L.findMemberRow(c, member);
    const [ins] = await c.query('INSERT INTO fines (member_id, type, description, transaction_ref, original_amount) VALUES (?, ?, ?, ?, ?)', [
      m.member_id,
      String(type).slice(0, 30),
      String(description).slice(0, 255),
      transactionId || null,
      Number(amount),
    ]);
    await L.assignCode(c, 'fines', 'fine_id', 'fine_code', 'FIN', 5, ins.insertId);
    await L.notify(c, { audience: 'member', memberId: m.member_id, type: 'fine', title: 'New charge added', message: `${type}: ${L.money(amount)}. ${description}`, link: 'fines.html' });
    return L.fineOut((await c.query(`${L.FINE_SQL} WHERE f.fine_id = ?`, [ins.insertId]))[0][0]);
  });
  res.status(201).json({ success: true, data });
});

// PATCH /fines/:id/discount  { discount }  — replaces any previous discount
exports.discountFine = asyncHandler(async (req, res) => {
  const out = await tx(async (c) => {
    const f = await findFine(c, req.user, req.params.id, true);
    const d = Number(req.body.discount);
    if (Number.isNaN(d) || d < 0) fail(400, 'Discount must be a positive number', { discount: 'Must be a positive number' });
    if (d > f.original_amount - f.paid_amount - f.waived_amount) fail(400, 'Discount cannot exceed the unpaid amount', { discount: 'Cannot exceed the unpaid amount' });
    await c.query('UPDATE fines SET discount = ? WHERE fine_id = ?', [d, f.fine_id]);
    await L.refreshFineStatus(c, f.fine_id);
    return { data: L.fineOut((await c.query(`${L.FINE_SQL} WHERE f.fine_id = ?`, [f.fine_id]))[0][0]), message: `Discount of ${L.money(d)} applied` };
  });
  res.json({ success: true, ...out });
});

// PATCH /fines/:id/waive  { reason }  — writes off the remaining balance
exports.waiveFine = asyncHandler(async (req, res) => {
  const out = await tx(async (c) => {
    const f = await findFine(c, req.user, req.params.id, true);
    const remaining = L.fineRemaining(f);
    if (remaining <= 0) fail(400, 'Nothing left to waive on this fine');
    await c.query('UPDATE fines SET waived_amount = waived_amount + ? WHERE fine_id = ?', [remaining, f.fine_id]);
    await L.refreshFineStatus(c, f.fine_id);
    const reason = String(req.body.reason || '').slice(0, 200);
    const [ins] = await c.query(
      `INSERT INTO fine_payments (member_id, fine_id, transaction_ref, reason, amount, payment_date, method, status, notes, received_by)
       VALUES (?, ?, ?, ?, ?, NOW(), 'Cash', 'Waived', ?, ?)`,
      [f.member_id, f.fine_id, f.loan_txn || f.transaction_ref, `${f.type} waived${reason ? ` — ${reason}` : ''}`, remaining, reason, req.user.user_id]
    );
    await L.assignCode(c, 'fine_payments', 'payment_id', 'payment_code', 'PAY', 5, ins.insertId);
    return {
      data: L.fineOut((await c.query(`${L.FINE_SQL} WHERE f.fine_id = ?`, [f.fine_id]))[0][0]),
      payment: L.paymentOut((await c.query(`${L.PAYMENT_SQL} WHERE p.payment_id = ?`, [ins.insertId]))[0][0]),
      message: `${L.money(remaining)} waived`,
    };
  });
  res.json({ success: true, ...out });
});

/* ================================ Payments ================================ */

exports.listPayments = asyncHandler(async (req, res) => {
  const q = req.query;
  const where = [];
  const params = [];
  if (req.user.role === 'student') {
    where.push('p.member_id = ?');
    params.push(req.user.memberId || -1);
  }
  if (q.status) {
    where.push('p.status = ?');
    params.push(q.status);
  }
  if (q.method) {
    where.push('p.method = ?');
    params.push(q.method);
  }
  if (q.member) {
    where.push('p.member_id = ?');
    params.push((await L.findMemberRow(pool, q.member)).member_id);
  }
  if (q.from) {
    where.push('p.payment_date >= ?');
    params.push(new Date(q.from));
  }
  if (q.to) {
    where.push('p.payment_date < ?');
    params.push(L.addDays(q.to, 1));
  }
  if (q.search) {
    const like = `%${q.search}%`;
    where.push('(p.payment_code LIKE ? OR p.receipt_no LIKE ? OR p.transaction_ref LIKE ? OR p.reason LIKE ? OR p.reference LIKE ? OR m.name LIKE ? OR m.member_code LIKE ?)');
    params.push(like, like, like, like, like, like, like);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const from = 'FROM fine_payments p JOIN members m ON m.member_id = p.member_id LEFT JOIN users u ON u.user_id = p.received_by LEFT JOIN fines f ON f.fine_id = p.fine_id';
  const [totals] = await pool.query(`SELECT p.status AS _id, SUM(p.amount) AS amount, COUNT(*) AS count ${from} ${w} GROUP BY p.status`, params);
  const pg = L.paginate(q, 15, 500);
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total ${from} ${w}`, params);
  const [rows] = await pool.query(
    `SELECT p.*, u.name AS collected_by_name, m.member_code, m.name AS member_name, m.email AS member_email, f.fine_code, f.type AS fine_type
     ${from} ${w} ORDER BY p.payment_date DESC, p.payment_id DESC LIMIT ? OFFSET ?`,
    [...params, pg.limit, pg.offset]
  );
  res.json({
    success: true,
    data: rows.map((r) => ({
      ...L.paymentOut(r),
      member: { _id: L.id(r.member_id), memberId: r.member_code, name: r.member_name, email: r.member_email },
      fine: r.fine_id ? { _id: L.id(r.fine_id), fineId: r.fine_code, type: r.fine_type } : null,
    })),
    totals: totals.map((t) => ({ _id: t._id, amount: L.round2(t.amount), count: Number(t.count) })),
    pagination: L.pageInfo(pg, total),
  });
});

exports.getPayment = asyncHandler(async (req, res) => {
  const s = await L.getSettings();
  const p = await findPayment(pool, req.user, req.params.id);
  const [[m]] = await pool.query(`${L.MEMBER_SQL} WHERE m.member_id = ?`, [p.member_id]);
  let fine = null;
  if (p.fine_id) {
    const [[f]] = await pool.query(`${L.FINE_SQL.replace('SELECT f.*,', 'SELECT f.*, b.book_code, b.title AS book_title,')} LEFT JOIN books b ON b.book_id = f.book_id WHERE f.fine_id = ?`, [p.fine_id]);
    fine = { ...L.fineOut(f), book: f.book_id ? { _id: L.id(f.book_id), bookId: f.book_code, title: f.book_title } : null };
  }
  res.json({ success: true, data: { ...L.paymentOut(p), member: L.memberOut(m), fine }, library: { name: s.libraryName } });
});

const reference = (method) => {
  const r = crypto.randomBytes(4).toString('hex').toUpperCase();
  return { UPI: `UPI${Date.now().toString().slice(-8)}${r.slice(0, 4)}`, Card: `AUTH-${r}`, 'Bank Transfer': `NEFT${Date.now().toString().slice(-10)}` }[method] || `CASH-${r.slice(0, 6)}`;
};

// POST /payments  { fine | member+reason, amount, method, status?: 'Pending', notes }
exports.createPayment = asyncHandler(async (req, res) => {
  const body = req.body;
  const amount = L.round2(body.amount);
  if (!(amount > 0)) fail(400, 'Amount must be greater than zero', { amount: 'Amount must be greater than zero' });
  const method = body.method || 'Cash';
  if (!METHODS.includes(method)) fail(400, 'Invalid payment method');
  const out = await tx(async (c) => {
    let fine = null;
    let memberId;
    if (body.fine) {
      fine = await findFine(c, req.user, body.fine, true);
      const remaining = L.fineRemaining(fine);
      if (remaining <= 0) fail(400, 'This fine is already settled');
      if (amount > remaining) fail(400, `Amount exceeds the remaining balance of ${L.money(remaining)}`, { amount: `Cannot exceed ${L.money(remaining)}` });
      memberId = fine.member_id;
    } else {
      memberId = (await L.findMemberRow(c, body.member)).member_id;
      if (!body.reason) fail(400, 'Reason is required for payments not linked to a fine', { reason: 'Reason is required' });
    }
    const pending = body.status === 'Pending';
    const status = pending ? 'Pending' : fine && amount < L.fineRemaining(fine) ? 'Partially Paid' : 'Paid';
    const reason = body.reason || (fine ? `${fine.type}${fine.description ? ` — ${fine.description}` : ''}` : '');
    const [ins] = await c.query(
      `INSERT INTO fine_payments (member_id, fine_id, transaction_ref, reason, amount, payment_date, method, status, reference, notes, received_by)
       VALUES (?, ?, ?, ?, ?, NOW(), ?, ?, ?, ?, ?)`,
      [memberId, fine?.fine_id || null, fine?.loan_txn || fine?.transaction_ref || body.transactionId || null, reason.slice(0, 255), amount, method, status, reference(method), String(body.notes || '').slice(0, 255), req.user.user_id]
    );
    await L.assignCode(c, 'fine_payments', 'payment_id', 'payment_code', 'PAY', 5, ins.insertId);
    if (!pending) await L.assignNextCode(c, 'fine_payments', 'payment_id', 'receipt_no', 'RCPT-', 6, ins.insertId);
    if (fine && !pending) {
      await c.query('UPDATE fines SET paid_amount = paid_amount + ? WHERE fine_id = ?', [amount, fine.fine_id]);
      await L.refreshFineStatus(c, fine.fine_id);
    }
    const [[p]] = await c.query(`${L.PAYMENT_SQL} WHERE p.payment_id = ?`, [ins.insertId]);
    if (!pending) {
      const [[m]] = await c.query('SELECT name FROM members WHERE member_id = ?', [memberId]);
      await L.notify(c, { audience: 'member', memberId, type: 'payment', title: 'Payment received', message: `${L.money(amount)} received via ${method} (${p.receipt_no}). Thank you!`, link: 'payments.html' });
      await L.notify(c, { type: 'payment', title: 'Payment completed', message: `${m.name} paid ${L.money(amount)} via ${method} — ${reason}.`, link: 'payments.html' });
    }
    const freshFine = fine ? L.fineOut((await c.query(`${L.FINE_SQL} WHERE f.fine_id = ?`, [fine.fine_id]))[0][0]) : null;
    return { data: L.paymentOut(p), fine: freshFine, message: pending ? 'Payment recorded as pending' : `Payment of ${L.money(amount)} successful` };
  });
  res.status(201).json({ success: true, ...out });
});

exports.confirmPayment = asyncHandler(async (req, res) => {
  const out = await tx(async (c) => {
    const p = await findPayment(c, req.user, req.params.id);
    if (p.status !== 'Pending') fail(400, 'Only pending payments can be confirmed');
    let status = 'Paid';
    if (p.fine_id) {
      const f = await findFine(c, req.user, p.fine_id, true);
      const remaining = L.fineRemaining(f);
      if (p.amount > remaining) fail(400, `Fine balance is now ${L.money(remaining)}; payment exceeds it`);
      await c.query('UPDATE fines SET paid_amount = paid_amount + ? WHERE fine_id = ?', [p.amount, f.fine_id]);
      await L.refreshFineStatus(c, f.fine_id);
      const [[{ status: fs }]] = await c.query('SELECT status FROM fines WHERE fine_id = ?', [f.fine_id]);
      status = fs === 'Paid' ? 'Paid' : 'Partially Paid';
    }
    await c.query('UPDATE fine_payments SET status = ?, payment_date = NOW() WHERE payment_id = ?', [status, p.payment_id]);
    const receipt = await L.assignNextCode(c, 'fine_payments', 'payment_id', 'receipt_no', 'RCPT-', 6, p.payment_id);
    await L.notify(c, { audience: 'member', memberId: p.member_id, type: 'payment', title: 'Payment confirmed', message: `${L.money(p.amount)} confirmed (${receipt}).`, link: 'payments.html' });
    return L.paymentOut((await c.query(`${L.PAYMENT_SQL} WHERE p.payment_id = ?`, [p.payment_id]))[0][0]);
  });
  res.json({ success: true, data: out, message: 'Payment confirmed' });
});
