const { pool, tx } = require('../config/db');
const { fail } = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const L = require('../utils/lib');

const studentScope = (user, alias) => (user.role === 'student' ? { sql: `${alias}.member_id = ?`, param: user.memberId || -1 } : null);

/* ================================= Issues ================================= */

exports.listIssues = asyncHandler(async (req, res) => {
  const q = req.query;
  const s = await L.getSettings();
  const where = [];
  const params = [];
  const scope = studentScope(req.user, 'l');
  if (scope) {
    where.push(scope.sql);
    params.push(scope.param);
  }
  if (q.status) {
    if (q.status === 'Active') where.push(`l.status IN ('Issued','Overdue')`);
    else {
      where.push('l.status = ?');
      params.push(q.status);
    }
  }
  if (q.search) {
    const like = `%${q.search}%`;
    where.push('(l.transaction_id LIKE ? OR m.member_code LIKE ? OR m.name LIKE ? OR b.book_code LIKE ? OR b.title LIKE ?)');
    params.push(like, like, like, like, like);
  }
  if (q.member) {
    where.push('l.member_id = ?');
    params.push((await L.findMemberRow(pool, q.member)).member_id);
  }
  if (q.from) {
    where.push('l.issue_date >= ?');
    params.push(new Date(q.from));
  }
  if (q.to) {
    where.push('l.issue_date < ?');
    params.push(L.addDays(q.to, 1));
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const pg = L.paginate(q, 15, 500);
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM loans l JOIN members m ON m.member_id = l.member_id JOIN books b ON b.book_id = l.book_id ${w}`,
    params
  );
  const [rows] = await pool.query(
    `${L.LOAN_SQL.replace('SELECT l.*,', 'SELECT l.*, b.cover_image, b.isbn, b.price,')} ${w} ORDER BY l.issue_date DESC, l.loan_id DESC LIMIT ? OFFSET ?`,
    [...params, pg.limit, pg.offset]
  );
  const data = rows.map((r) => {
    const o = { ...L.issueOut(r), book: { _id: L.id(r.book_id), bookId: r.book_code, title: r.book_title, coverImage: r.cover_image || '', isbn: r.isbn, price: r.price } };
    if (L.ACTIVE.includes(r.status)) {
      o.daysOverdue = L.daysBetween(r.due_date, new Date());
      o.estimatedFine = o.daysOverdue * s.finePerDay;
    }
    return o;
  });
  res.json({ success: true, data, pagination: L.pageInfo(pg, total) });
});

exports.getIssue = asyncHandler(async (req, res) => {
  const i = await L.findLoanRow(pool, req.user, req.params.id);
  const [[book]] = await pool.query(`${L.BOOK_SQL} WHERE b.book_id = ?`, [i.book_id]);
  const [[member]] = await pool.query(`${L.MEMBER_SQL} WHERE m.member_id = ?`, [i.member_id]);
  const [fines] = await pool.query(`${L.FINE_SQL} WHERE f.loan_id = ?`, [i.loan_id]);
  res.json({
    success: true,
    data: { ...L.issueOut(i), book: L.bookOut(book), member: L.memberOut(member) },
    return: i.return_date ? L.returnOut(i) : null,
    fines: fines.map(L.fineOut),
  });
});

/** Issues a book after the eligibility checks. Shared with reservation pickup. */
async function createIssue(c, user, body) {
  const s = await L.getSettings(c);
  const m = await L.findMemberRow(c, body.member);
  await c.query('SELECT member_id FROM members WHERE member_id = ? FOR UPDATE', [m.member_id]);
  const b = await L.findBookRow(c, body.book, { lock: true });

  if (m.status !== 'Active') fail(400, `Membership is ${m.status}. Book cannot be issued.`);
  if (new Date(m.membership_expiry) < new Date()) fail(400, 'Membership has expired. Renew it first.');
  if (m.books_issued >= s.maxBooksPerMember) fail(400, `Member already has ${m.books_issued} books (limit ${s.maxBooksPerMember}).`);
  if (m.pending_fine > s.maxPendingFine) fail(400, `Member has ${L.money(m.pending_fine)} pending fines (limit ${L.money(s.maxPendingFine)}). Collect payment first.`);
  const [[dup]] = await c.query(`SELECT loan_id FROM loans WHERE member_id = ? AND book_id = ? AND status IN ('Issued','Overdue')`, [m.member_id, b.book_id]);
  if (dup) fail(400, 'This member already has a copy of this book.');
  const [[held]] = await c.query(`SELECT reservation_id FROM reservations WHERE member_id = ? AND book_id = ? AND status = 'Available' FOR UPDATE`, [m.member_id, b.book_id]);
  const counts = await L.recalcBook(c, b.book_id);
  if (!held && counts.available < 1) fail(400, `No copies of "${b.title}" are available. You can reserve it instead.`);

  const issueDate = body.issueDate ? new Date(body.issueDate) : new Date();
  if (Number.isNaN(issueDate.getTime()) || issueDate > new Date(Date.now() + 60000)) fail(400, 'Issue date cannot be in the future', { issueDate: 'Cannot be in the future' });
  const due = body.dueDate ? new Date(body.dueDate) : L.addDays(issueDate, Number(body.days) || s.loanDays);
  // A back-dated issue (recording a paper loan) only needs a due date after the issue date.
  const minDue = body.issueDate ? L.startOfDay(issueDate) : L.startOfDay(new Date());
  if (Number.isNaN(due.getTime()) || L.startOfDay(due) <= minDue) fail(400, 'Due date must be after the issue date', { dueDate: 'Due date must be after the issue date' });
  due.setHours(23, 59, 0, 0);
  const status = due < L.startOfDay(new Date()) ? 'Overdue' : 'Issued';

  const [ins] = await c.query(`INSERT INTO loans (member_id, book_id, issued_by, issue_date, due_date, status) VALUES (?, ?, ?, ?, ?, ?)`, [
    m.member_id,
    b.book_id,
    user.user_id,
    issueDate,
    due,
    status,
  ]);
  await L.assignCode(c, 'loans', 'loan_id', 'transaction_id', 'TXN', 5, ins.insertId);
  if (held) await c.query(`UPDATE reservations SET status = 'Collected' WHERE reservation_id = ?`, [held.reservation_id]);
  else await c.query(`UPDATE reservations SET status = 'Collected' WHERE member_id = ? AND book_id = ? AND status = 'Waiting'`, [m.member_id, b.book_id]);
  await c.query('UPDATE books SET times_borrowed = times_borrowed + 1 WHERE book_id = ?', [b.book_id]);
  await L.processReservationQueue(c, b.book_id, s);
  await L.notify(c, {
    audience: 'member',
    memberId: m.member_id,
    type: 'issued',
    title: 'Book issued',
    message: `"${b.title}" has been issued to you. Due date: ${due.toDateString()}.`,
    link: `book-details.html?id=${b.book_code}`,
  });
  const [[loan]] = await c.query(`${L.LOAN_SQL} WHERE l.loan_id = ?`, [ins.insertId]);
  const [[book]] = await c.query(`${L.BOOK_SQL} WHERE b.book_id = ?`, [b.book_id]);
  return { success: true, data: L.issueOut(loan), book: L.bookOut(book) };
}

exports.createIssue = asyncHandler(async (req, res) => {
  if (!req.body.member) fail(400, 'Member is required', { member: 'Member is required' });
  if (!req.body.book) fail(400, 'Book is required', { book: 'Book is required' });
  res.status(201).json(await tx((c) => createIssue(c, req.user, req.body)));
});

exports.renewIssue = asyncHandler(async (req, res) => {
  const out = await tx(async (c) => {
    const s = await L.getSettings(c);
    const i = await L.findLoanRow(c, req.user, req.params.id, { lock: true });
    if (!L.ACTIVE.includes(i.status)) fail(400, `Cannot renew a ${i.status.toLowerCase()} transaction`);
    if (i.status === 'Overdue' || L.startOfDay(i.due_date) < L.startOfDay(new Date())) fail(400, 'Overdue books cannot be renewed. Please return the book and clear the fine.');
    if (i.renewal_count >= s.maxRenewals) fail(400, `Renewal limit reached (${s.maxRenewals})`);
    const [[{ waiting }]] = await c.query(`SELECT COUNT(*) AS waiting FROM reservations WHERE book_id = ? AND status = 'Waiting'`, [i.book_id]);
    if (waiting) fail(400, `Cannot renew — ${waiting} member(s) are waiting for this book`);
    const due = L.addDays(i.due_date, s.loanDays);
    await c.query('UPDATE loans SET due_date = ?, renewal_count = renewal_count + 1, due_soon_notified = 0 WHERE loan_id = ?', [due, i.loan_id]);
    await L.notify(c, {
      audience: 'member',
      memberId: i.member_id,
      type: 'issued',
      title: 'Book renewed',
      message: `"${i.book_title}" renewed. New due date: ${due.toDateString()}.`,
      link: 'issues.html',
    });
    const [[loan]] = await c.query(`${L.LOAN_SQL} WHERE l.loan_id = ?`, [i.loan_id]);
    return { success: true, data: L.issueOut(loan), message: `Renewed until ${due.toDateString()}` };
  });
  res.json(out);
});

/* ================================= Returns ================================= */

function charges(loan, price, s, { condition = 'Good', returnDate = new Date(), damageCharge } = {}) {
  const daysOverdue = L.daysBetween(loan.due_date, returnDate);
  const lateFine = daysOverdue * s.finePerDay;
  const dmg =
    condition === 'Damaged' ? (damageCharge !== undefined && damageCharge !== '' ? Number(damageCharge) : L.round2((price * s.damageChargePercent) / 100)) : 0;
  const lost = condition === 'Lost' ? L.round2(price + s.lostProcessingFee) : 0;
  return { daysOverdue, lateFine, damageCharge: dmg, lostCharge: lost, totalFine: L.round2(lateFine + dmg + lost), finePerDay: s.finePerDay };
}

// GET /returns/lookup?q=  — active loans matching a transaction, member, book ID, ISBN or name, with the fine so far
exports.lookupReturns = asyncHandler(async (req, res) => {
  const s = await L.getSettings();
  const term = String(req.query.q || '').trim();
  let rows = [];
  if (term) {
    const like = `%${term}%`;
    [rows] = await pool.query(
      `SELECT l.*, m.member_code, m.name AS member_name, m.email AS member_email, b.book_code, b.title AS book_title, b.isbn, b.price,
              b.cover_image, a.name AS author_name, u.name AS staff_name
       FROM loans l JOIN members m ON m.member_id = l.member_id JOIN books b ON b.book_id = l.book_id
       JOIN authors a ON a.author_id = b.author_id LEFT JOIN users u ON u.user_id = l.issued_by
       WHERE l.status IN ('Issued','Overdue')
         AND (l.transaction_id = ? OR m.member_code = ? OR b.book_code = ? OR b.isbn = ? OR m.neptun_code = ?
              OR CAST(l.book_id AS CHAR) = ? OR m.name LIKE ? OR b.title LIKE ?)
       ORDER BY l.due_date LIMIT 25`,
      [term.toUpperCase(), term.toUpperCase(), term.toUpperCase(), term, term.toUpperCase(), term, like, like]
    );
  }
  const ids = [...new Set(rows.map((r) => r.member_id))];
  const pending = {};
  if (ids.length) {
    const [p] = await pool.query(
      `SELECT member_id, SUM(original_amount - discount - paid_amount - waived_amount) AS due FROM fines
       WHERE member_id IN (?) AND status IN ('Pending','Partially Paid') GROUP BY member_id`,
      [ids]
    );
    p.forEach((x) => (pending[x.member_id] = L.round2(x.due)));
  }
  const data = rows.map((r) => ({
    ...L.issueOut(r),
    book: { _id: L.id(r.book_id), bookId: r.book_code, title: r.book_title, isbn: r.isbn, price: r.price, coverImage: r.cover_image || '', authorName: r.author_name },
    member: { _id: L.id(r.member_id), memberId: r.member_code, name: r.member_name, email: r.member_email, pendingFine: pending[r.member_id] || 0 },
    charges: charges(r, r.price, s),
  }));
  res.json({ success: true, data, settings: { finePerDay: s.finePerDay, damageChargePercent: s.damageChargePercent, lostProcessingFee: s.lostProcessingFee } });
});

exports.listReturns = asyncHandler(async (req, res) => {
  const where = ['l.return_date IS NOT NULL'];
  const params = [];
  const scope = studentScope(req.user, 'l');
  if (scope) {
    where.push(scope.sql);
    params.push(scope.param);
  }
  if (req.query.condition) {
    where.push('l.return_condition = ?');
    params.push(req.query.condition);
  }
  const w = `WHERE ${where.join(' AND ')}`;
  const pg = L.paginate(req.query, 15, 500);
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM loans l ${w}`, params);
  const [rows] = await pool.query(`${L.LOAN_SQL} ${w} ORDER BY l.return_date DESC LIMIT ? OFFSET ?`, [...params, pg.limit, pg.offset]);
  res.json({
    success: true,
    data: rows.map((r) => ({
      ...L.returnOut(r),
      book: { _id: L.id(r.book_id), bookId: r.book_code, title: r.book_title },
      member: { _id: L.id(r.member_id), memberId: r.member_code, name: r.member_name },
    })),
    pagination: L.pageInfo(pg, total),
  });
});

// POST /returns  { issue, condition: Good|Damaged|Lost, returnDate?, damageCharge?, remarks? }
exports.createReturn = asyncHandler(async (req, res) => {
  const body = req.body;
  if (!body.issue) fail(400, 'Transaction is required', { issue: 'Transaction is required' });
  const out = await tx(async (c) => {
    const s = await L.getSettings(c);
    const i = await L.findLoanRow(c, req.user, body.issue, { lock: true });
    if (!L.ACTIVE.includes(i.status)) fail(400, `This transaction is already ${i.status.toLowerCase()}`);
    const condition = ['Good', 'Damaged', 'Lost'].includes(body.condition) ? body.condition : 'Good';
    const returnDate = body.returnDate ? new Date(body.returnDate) : new Date();
    if (Number.isNaN(returnDate.getTime()) || returnDate < L.startOfDay(i.issue_date)) fail(400, 'Return date cannot be before the issue date');
    if (returnDate > new Date(Date.now() + 60000)) fail(400, 'Return date cannot be in the future');
    if (body.damageCharge !== undefined && body.damageCharge !== '' && !(Number(body.damageCharge) >= 0)) fail(400, 'Damage charge must be a positive number');

    const [[book]] = await c.query('SELECT book_id, book_code, title, price FROM books WHERE book_id = ? FOR UPDATE', [i.book_id]);
    const ch = charges(i, book.price, s, { condition, returnDate, damageCharge: body.damageCharge });
    await c.query(
      `UPDATE loans SET return_date = ?, status = ?, return_condition = ?, fine_amount = ?, days_overdue = ?, late_fine = ?,
         damage_charge = ?, lost_charge = ?, remarks = ?, processed_by = ? WHERE loan_id = ?`,
      [returnDate, condition === 'Good' ? 'Returned' : condition, condition, ch.totalFine, ch.daysOverdue, ch.lateFine, ch.damageCharge, ch.lostCharge, String(body.remarks || '').slice(0, 255), req.user.user_id, i.loan_id]
    );
    await L.assignNextCode(c, 'loans', 'loan_id', 'return_code', 'RET', 5, i.loan_id);
    if (condition === 'Lost') await c.query('UPDATE books SET lost_copies = lost_copies + 1 WHERE book_id = ?', [book.book_id]);
    if (condition === 'Damaged') await c.query('UPDATE books SET damaged_copies = damaged_copies + 1 WHERE book_id = ?', [book.book_id]);

    const newFines = [];
    const addFine = async (type, amount, description, extra = {}) => {
      const [ins] = await c.query(
        `INSERT INTO fines (member_id, loan_id, book_id, type, description, days_overdue, rate_per_day, original_amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [i.member_id, i.loan_id, book.book_id, type, description, extra.days || 0, extra.rate || 0, amount]
      );
      await L.assignCode(c, 'fines', 'fine_id', 'fine_code', 'FIN', 5, ins.insertId);
      newFines.push(ins.insertId);
    };
    if (ch.lateFine > 0) await addFine('Late Fine', ch.lateFine, `${ch.daysOverdue} day(s) late × ${L.money(s.finePerDay)}/day`, { days: ch.daysOverdue, rate: s.finePerDay });
    if (ch.damageCharge > 0) await addFine('Damage', ch.damageCharge, `Damage charge for "${book.title}"`);
    if (ch.lostCharge > 0) await addFine('Lost Book', ch.lostCharge, `Replacement ${L.money(book.price)} + processing ${L.money(s.lostProcessingFee)}`);

    if (newFines.length) {
      await L.notify(c, {
        audience: 'member',
        memberId: i.member_id,
        type: 'fine',
        title: 'Fine generated',
        message: `A fine of ${L.money(ch.totalFine)} was generated for "${book.title}" (${i.transaction_id}).`,
        link: 'fines.html',
      });
    }
    await L.notify(c, {
      type: 'returned',
      title: condition === 'Good' ? 'Book returned' : `Book reported ${condition.toLowerCase()}`,
      message: `${i.member_name} returned "${book.title}"${ch.daysOverdue ? ` ${ch.daysOverdue} day(s) late` : ''}${ch.totalFine ? ` — fine ${L.money(ch.totalFine)}` : ''}.`,
      link: 'returns.html',
    });
    await L.processReservationQueue(c, book.book_id, s);

    const [[ret]] = await c.query(`${L.LOAN_SQL} WHERE l.loan_id = ?`, [i.loan_id]);
    const [fines] = newFines.length ? await c.query(`${L.FINE_SQL} WHERE f.fine_id IN (?)`, [newFines]) : [[]];
    const [[updated]] = await c.query(`${L.BOOK_SQL} WHERE b.book_id = ?`, [book.book_id]);
    return {
      success: true,
      data: L.returnOut(ret),
      fines: fines.map(L.fineOut),
      book: L.bookOut(updated),
      message: ch.totalFine ? `Returned with fine ${L.money(ch.totalFine)}` : 'Returned on time — no fine',
    };
  });
  res.status(201).json(out);
});

/* ============================== Reservations ============================== */

async function findReservation(db, user, ref, lock = false) {
  const r = String(ref || '').trim();
  const [[row]] = await db.query(`SELECT * FROM reservations WHERE ${L.isPk(r) ? 'reservation_id' : 'reservation_code'} = ? ${lock ? 'FOR UPDATE' : ''}`, [
    L.isPk(r) ? Number(r) : r.toUpperCase(),
  ]);
  if (!row || (user.role === 'student' && row.member_id !== user.memberId)) fail(404, 'Reservation not found');
  return row;
}

exports.listReservations = asyncHandler(async (req, res) => {
  const where = [];
  const params = [];
  const scope = studentScope(req.user, 'r');
  if (scope) {
    where.push(scope.sql);
    params.push(scope.param);
  }
  if (req.query.status) {
    where.push('r.status = ?');
    params.push(req.query.status);
  }
  if (req.query.book) {
    where.push('r.book_id = ?');
    params.push((await L.findBookRow(pool, req.query.book)).book_id);
  }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const pg = L.paginate(req.query, 15, 500);
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM reservations r ${w}`, params);
  const [rows] = await pool.query(
    `SELECT r.*, b.book_code, b.title, b.cover_image, b.available_copies, b.isbn, a.name AS author_name,
            s.code AS shelf_code, s.floor AS shelf_floor, s.section AS shelf_section, b.shelf_id, b.rack, b.shelf_row, b.position,
            m.member_code, m.name AS member_name, m.email AS member_email
     FROM reservations r JOIN books b ON b.book_id = r.book_id JOIN authors a ON a.author_id = b.author_id
     LEFT JOIN shelves s ON s.shelf_id = b.shelf_id JOIN members m ON m.member_id = r.member_id
     ${w}
     ORDER BY FIELD(r.status, 'Available', 'Cancelled', 'Collected', 'Expired', 'Waiting'), r.reservation_date DESC
     LIMIT ? OFFSET ?`,
    [...params, pg.limit, pg.offset]
  );
  const data = rows.map((r) => ({
    ...L.reservationOut(r),
    book: {
      _id: L.id(r.book_id),
      bookId: r.book_code,
      title: r.title,
      coverImage: r.cover_image || '',
      availableCopies: r.available_copies,
      isbn: r.isbn,
      authorName: r.author_name,
      location: r.shelf_id ? { shelf: L.id(r.shelf_id), shelfCode: r.shelf_code, floor: r.shelf_floor, section: r.shelf_section, rack: r.rack, row: r.shelf_row, position: r.position } : null,
    },
    member: { _id: L.id(r.member_id), memberId: r.member_code, name: r.member_name, email: r.member_email },
  }));
  res.json({ success: true, data, pagination: L.pageInfo(pg, total) });
});

exports.createReservation = asyncHandler(async (req, res) => {
  if (!req.body.book) fail(400, 'Book is required', { book: 'Book is required' });
  const out = await tx(async (c) => {
    const s = await L.getSettings(c);
    const ref = req.user.role === 'student' ? req.user.memberId : req.body.member;
    if (!ref) fail(400, req.user.role === 'student' ? 'Your account is not linked to a library membership' : 'Member is required');
    const m = await L.findMemberRow(c, ref);
    const b = await L.findBookRow(c, req.body.book, { lock: true });
    if (m.status !== 'Active') fail(400, `Membership is ${m.status}. Cannot reserve.`);
    const [[active]] = await c.query(`SELECT 1 FROM reservations WHERE member_id = ? AND book_id = ? AND status IN ('Waiting','Available')`, [m.member_id, b.book_id]);
    if (active) fail(400, 'This member already has an active reservation for this book');
    const [[issued]] = await c.query(`SELECT 1 FROM loans WHERE member_id = ? AND book_id = ? AND status IN ('Issued','Overdue')`, [m.member_id, b.book_id]);
    if (issued) fail(400, 'This member currently has this book issued');
    const [ins] = await c.query(`INSERT INTO reservations (member_id, book_id, reservation_date, expiry_date, status, created_by) VALUES (?, ?, NOW(), ?, 'Waiting', ?)`, [
      m.member_id,
      b.book_id,
      L.addDays(new Date(), s.reservationValidityDays),
      req.user.user_id,
    ]);
    await L.assignCode(c, 'reservations', 'reservation_id', 'reservation_code', 'RES', 5, ins.insertId);
    await L.processReservationQueue(c, b.book_id, s);
    const [[r]] = await c.query('SELECT * FROM reservations WHERE reservation_id = ?', [ins.insertId]);
    await L.notify(c, {
      type: 'reservation',
      title: 'New reservation',
      message: `${m.name} reserved "${b.title}" (${r.status === 'Available' ? 'ready for pickup' : `queue #${r.queue_position}`}).`,
      link: 'reservations.html',
    });
    return {
      success: true,
      data: { ...L.reservationOut(r), book: { _id: L.id(b.book_id), bookId: b.book_code, title: b.title }, member: { _id: L.id(m.member_id), memberId: m.member_code, name: m.name } },
      message: r.status === 'Available' ? 'A copy is on hold — ready for pickup' : `Reserved — position #${r.queue_position} in queue`,
    };
  });
  res.status(201).json(out);
});

exports.cancelReservation = asyncHandler(async (req, res) => {
  const out = await tx(async (c) => {
    const r = await findReservation(c, req.user, req.params.id, true);
    if (!['Waiting', 'Available'].includes(r.status)) fail(400, `Reservation is already ${r.status.toLowerCase()}`);
    await c.query(`UPDATE reservations SET status = 'Cancelled' WHERE reservation_id = ?`, [r.reservation_id]);
    await L.processReservationQueue(c, r.book_id);
    return L.reservationOut((await c.query('SELECT * FROM reservations WHERE reservation_id = ?', [r.reservation_id]))[0][0]);
  });
  res.json({ success: true, data: out, message: 'Reservation cancelled' });
});

// PATCH /reservations/:id/collect — issue the held copy to the member
exports.collectReservation = asyncHandler(async (req, res) => {
  const out = await tx(async (c) => {
    const r = await findReservation(c, req.user, req.params.id, true);
    if (r.status !== 'Available') fail(400, 'Only reservations marked "Available" can be collected');
    return createIssue(c, req.user, { member: r.member_id, book: r.book_id, days: req.body?.days });
  });
  res.status(201).json(out);
});

exports.deleteReservation = asyncHandler(async (req, res) => {
  const r = await findReservation(pool, req.user, req.params.id);
  if (['Waiting', 'Available'].includes(r.status)) fail(400, 'Cancel the reservation before deleting it');
  await pool.query('DELETE FROM reservations WHERE reservation_id = ?', [r.reservation_id]);
  res.json({ success: true, message: 'Reservation deleted' });
});
