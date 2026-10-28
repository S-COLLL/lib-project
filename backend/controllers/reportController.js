const { pool } = require('../config/db');
const { fail } = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const { runMaintenance } = require('../utils/maintenance');
const L = require('../utils/lib');

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function lastMonths(n) {
  const d = new Date();
  return Array.from({ length: n }, (_, i) => {
    const m = new Date(d.getFullYear(), d.getMonth() - (n - 1 - i), 1);
    return { key: `${m.getFullYear()}-${String(m.getMonth() + 1).padStart(2, '0')}`, label: `${MONTHS[m.getMonth()]} '${String(m.getFullYear()).slice(2)}` };
  });
}
async function monthly(sql, months) {
  const [rows] = await pool.query(sql, [new Date(`${months[0].key}-01T00:00:00`)]);
  const map = Object.fromEntries(rows.map((r) => [r.ym, L.round2(r.v)]));
  return months.map((m) => map[m.key] || 0);
}

exports.dashboard = asyncHandler(async (req, res) => {
  await runMaintenance();
  const s = await L.getSettings();
  const now = new Date();
  const months = lastMonths(6);

  const [[b]] = await pool.query(
    `SELECT COALESCE(SUM(quantity),0) AS total, COUNT(*) AS titles, COALESCE(SUM(available_copies),0) AS available, COALESCE(SUM(issued_copies),0) AS issued,
            COALESCE(SUM(reserved_copies),0) AS reserved, COALESCE(SUM(lost_copies),0) AS lost, COALESCE(SUM(damaged_copies),0) AS damaged,
            COALESCE(SUM(current_value * quantity),0) AS value, SUM(created_at >= ?) AS recent
     FROM books`,
    [L.addDays(now, -30)]
  );
  const [[m]] = await pool.query(`SELECT COUNT(*) AS total, SUM(status = 'Active') AS active FROM members`);
  const [[{ waiting }]] = await pool.query(`SELECT COUNT(*) AS waiting FROM reservations WHERE status = 'Waiting'`);
  const [[f]] = await pool.query(`SELECT COALESCE(SUM(original_amount - discount),0) AS total, COALESCE(SUM(paid_amount + waived_amount),0) AS settled FROM fines`);
  const [[{ collected }]] = await pool.query(`SELECT COALESCE(SUM(amount),0) AS collected FROM fine_payments WHERE status IN ('Paid','Partially Paid')`);
  const [overdue] = await pool.query(
    `${L.LOAN_SQL.replace('SELECT l.*,', 'SELECT l.*, b.cover_image,')} WHERE l.status = 'Overdue' ORDER BY l.due_date`
  );
  const accruing = overdue.reduce((t, i) => t + L.daysBetween(i.due_date, now) * s.finePerDay, 0);

  const [cats] = await pool.query(
    `SELECT c.name AS label, COALESCE(SUM(b.quantity),0) AS value, COUNT(b.book_id) AS titles FROM categories c
     JOIN books b ON b.category_id = c.category_id GROUP BY c.category_id ORDER BY value DESC`
  );
  const [popular] = await pool.query(
    `SELECT b.title AS label, a.name AS author, b.times_borrowed AS value, b.book_code AS id FROM books b JOIN authors a ON a.author_id = b.author_id
     WHERE b.times_borrowed > 0 ORDER BY b.times_borrowed DESC, b.title LIMIT 7`
  );
  const [shelves] = await pool.query(`${L.SHELF_SQL} ORDER BY s.floor, s.code`);
  const [recentTx] = await pool.query(`${L.LOAN_SQL} ORDER BY l.updated_at DESC, l.loan_id DESC LIMIT 8`);
  const [recentMembers] = await pool.query(`${L.MEMBER_SQL} ORDER BY m.created_at DESC, m.member_id DESC LIMIT 5`);
  const [recentBooks] = await pool.query(`${L.BOOK_SQL} ORDER BY b.created_at DESC, b.book_id DESC LIMIT 5`);

  res.json({
    success: true,
    data: {
      stats: {
        totalBooks: Number(b.total),
        titles: Number(b.titles),
        availableBooks: Number(b.available),
        issuedBooks: Number(b.issued),
        reservedBooks: Number(b.reserved),
        waitingReservations: Number(waiting),
        lostBooks: Number(b.lost),
        damagedBooks: Number(b.damaged),
        totalMembers: Number(m.total),
        activeMembers: Number(m.active || 0),
        overdueBooks: overdue.length,
        totalFines: L.round2(f.total + accruing),
        finesOutstanding: L.round2(f.total - f.settled + accruing),
        accruingFines: accruing,
        totalCollected: L.round2(collected),
        booksAddedRecently: Number(b.recent || 0),
        collectionValue: L.round2(b.value),
      },
      charts: {
        months: months.map((x) => x.label),
        issued: await monthly(`SELECT DATE_FORMAT(issue_date, '%Y-%m') AS ym, COUNT(*) AS v FROM loans WHERE issue_date >= ? GROUP BY ym`, months),
        returned: await monthly(`SELECT DATE_FORMAT(return_date, '%Y-%m') AS ym, COUNT(*) AS v FROM loans WHERE return_date >= ? GROUP BY ym`, months),
        fines: await monthly(`SELECT DATE_FORMAT(created_at, '%Y-%m') AS ym, SUM(original_amount) AS v FROM fines WHERE created_at >= ? GROUP BY ym`, months),
        collected: await monthly(
          `SELECT DATE_FORMAT(payment_date, '%Y-%m') AS ym, SUM(amount) AS v FROM fine_payments WHERE status IN ('Paid','Partially Paid') AND payment_date >= ? GROUP BY ym`,
          months
        ),
        popular: popular.map((p) => ({ ...p, value: Number(p.value) })),
        categories: cats.map((c) => ({ label: c.label, value: Number(c.value), titles: Number(c.titles) })),
        shelves: shelves.map((x) => {
          const o = L.shelfOut(x);
          return { label: o.name, code: o.code, floor: o.floor, section: o.section, occupied: o.occupied, capacity: o.capacity, percent: o.capacity ? Math.round((o.occupied / o.capacity) * 100) : 0 };
        }),
      },
      recentTransactions: recentTx.map(L.issueOut),
      recentMembers: recentMembers.map(L.memberOut),
      recentBooks: recentBooks.map((r) => L.bookOut(r)),
      overdue: overdue.slice(0, 6).map((i) => {
        const d = L.daysBetween(i.due_date, now);
        return { ...L.issueOut(i), book: { _id: L.id(i.book_id), bookId: i.book_code, title: i.book_title, coverImage: i.cover_image || '' }, daysOverdue: d, fine: d * s.finePerDay };
      }),
    },
  });
});

/* ================================ Reports ================================ */

const ymd = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
function range(q, col) {
  const where = [];
  const params = [];
  if (q.from) {
    where.push(`${col} >= ?`);
    params.push(new Date(q.from));
  }
  if (q.to) {
    where.push(`${col} < ?`);
    params.push(L.addDays(q.to, 1));
  }
  return { sql: where.length ? ` AND ${where.join(' AND ')}` : '', params };
}

const REPORTS = {
  books: {
    title: 'Books Report',
    columns: ['Book ID', 'Title', 'Author', 'Category', 'ISBN', 'Total', 'Available', 'Issued', 'Price (Ft)', 'Location', 'Status'],
    async rows() {
      const [r] = await pool.query(`${L.BOOK_SQL} ORDER BY b.book_code`);
      return r.map((b) => [b.book_code, b.title, b.author_name, b.category_name, b.isbn, b.quantity, b.available_copies, b.issued_copies, b.price, b.shelf_code ? `F${b.shelf_floor}-${b.shelf_code}-R${b.rack}-${b.shelf_row}${b.position}` : '', b.status]);
    },
  },
  issued: {
    title: 'Issued Books Report',
    columns: ['Transaction', 'Member ID', 'Member', 'Book ID', 'Book', 'Issue Date', 'Due Date', 'Renewals', 'Staff', 'Status'],
    async rows(q) {
      const rg = range(q, 'l.issue_date');
      const [r] = await pool.query(`${L.LOAN_SQL} WHERE l.status IN ('Issued','Overdue')${rg.sql} ORDER BY l.issue_date DESC`, rg.params);
      return r.map((i) => [i.transaction_id, i.member_code, i.member_name, i.book_code, i.book_title, ymd(i.issue_date), ymd(i.due_date), i.renewal_count, i.staff_name || '', i.status]);
    },
  },
  returned: {
    title: 'Returned Books Report',
    columns: ['Return ID', 'Transaction', 'Member', 'Book', 'Issue Date', 'Due Date', 'Return Date', 'Days Late', 'Condition', 'Fine (Ft)'],
    async rows(q) {
      const rg = range(q, 'l.return_date');
      const [r] = await pool.query(`${L.LOAN_SQL} WHERE l.return_date IS NOT NULL${rg.sql} ORDER BY l.return_date DESC`, rg.params);
      return r.map((i) => [i.return_code, i.transaction_id, i.member_name, i.book_title, ymd(i.issue_date), ymd(i.due_date), ymd(i.return_date), i.days_overdue, i.return_condition, i.fine_amount]);
    },
  },
  overdue: {
    title: 'Overdue Report',
    columns: ['Transaction', 'Member ID', 'Member', 'Book', 'Due Date', 'Days Overdue', 'Fine So Far (Ft)'],
    async rows() {
      const s = await L.getSettings();
      const [r] = await pool.query(`${L.LOAN_SQL} WHERE l.status = 'Overdue' ORDER BY l.due_date`);
      return r.map((i) => {
        const d = L.daysBetween(i.due_date, new Date());
        return [i.transaction_id, i.member_code, i.member_name, i.book_title, ymd(i.due_date), d, d * s.finePerDay];
      });
    },
  },
  fines: {
    title: 'Fine Report',
    columns: ['Fine ID', 'Member', 'Type', 'Transaction', 'Original (Ft)', 'Discount (Ft)', 'Paid (Ft)', 'Waived (Ft)', 'Remaining (Ft)', 'Status', 'Date'],
    async rows(q) {
      const rg = range(q, 'f.created_at');
      const [r] = await pool.query(
        `SELECT f.*, l.transaction_id AS loan_txn, m.name AS member_name, m.member_code FROM fines f LEFT JOIN loans l ON l.loan_id = f.loan_id
         JOIN members m ON m.member_id = f.member_id WHERE 1=1${rg.sql} ORDER BY f.created_at DESC`,
        rg.params
      );
      return r.map((f) => [f.fine_code, `${f.member_name} (${f.member_code})`, f.type, f.loan_txn || f.transaction_ref || '', f.original_amount, f.discount, f.paid_amount, f.waived_amount, L.fineRemaining(f), f.status, ymd(f.created_at)]);
    },
  },
  payments: {
    title: 'Payment Report',
    columns: ['Payment ID', 'Receipt', 'Member', 'Reason', 'Amount (Ft)', 'Method', 'Status', 'Date', 'Collected By'],
    async rows(q) {
      const rg = range(q, 'p.payment_date');
      const [r] = await pool.query(
        `SELECT p.*, u.name AS collected_by_name, m.name AS member_name, m.member_code FROM fine_payments p JOIN members m ON m.member_id = p.member_id
         LEFT JOIN users u ON u.user_id = p.received_by WHERE 1=1${rg.sql} ORDER BY p.payment_date DESC`,
        rg.params
      );
      return r.map((p) => [p.payment_code, p.receipt_no || '—', `${p.member_name} (${p.member_code})`, p.reason, p.amount, p.method, p.status, ymd(p.payment_date), p.collected_by_name || '']);
    },
  },
  members: {
    title: 'Member Report',
    columns: ['Member ID', 'Name', 'Email', 'Neptun', 'Phone', 'Department', 'Type', 'Expiry', 'Issued', 'Returned', 'Pending Fine (Ft)', 'Paid (Ft)', 'Status'],
    async rows() {
      const [r] = await pool.query(`${L.MEMBER_SQL} ORDER BY m.member_code`);
      return r.map(L.memberOut).map((m) => [m.memberId, m.name, m.email, m.neptunCode, m.phone, m.department, m.membershipType, ymd(m.membershipExpiry), m.booksIssued, m.booksReturned, m.pendingFine, m.totalFinePaid, m.status]);
    },
  },
  popular: {
    title: 'Popular Books Report',
    columns: ['Rank', 'Book ID', 'Title', 'Author', 'Category', 'Times Borrowed', 'Available / Total'],
    async rows() {
      const [r] = await pool.query(`${L.BOOK_SQL} ORDER BY b.times_borrowed DESC, b.title LIMIT 25`);
      return r.map((b, i) => [i + 1, b.book_code, b.title, b.author_name, b.category_name, b.times_borrowed, `${b.available_copies} / ${b.quantity}`]);
    },
  },
  shelves: {
    title: 'Shelf Occupancy Report',
    columns: ['Shelf ID', 'Name', 'Floor', 'Section', 'Racks', 'Capacity', 'Occupied', 'Available', 'Occupancy %', 'Status'],
    async rows() {
      const [r] = await pool.query(`${L.SHELF_SQL} ORDER BY s.floor, s.code`);
      return r.map(L.shelfOut).map((x) => [x.shelfId, x.name, x.floor, x.section, x.racks, x.capacity, x.occupied, x.availableSpace, `${x.occupancyPercent}%`, x.status]);
    },
  },
};

exports.listReports = asyncHandler(async (req, res) => {
  res.json({ success: true, data: Object.entries(REPORTS).map(([key, r]) => ({ key, title: r.title })) });
});

exports.getReport = asyncHandler(async (req, res) => {
  const r = REPORTS[req.params.type];
  if (!r) fail(404, 'Unknown report type');
  res.json({ success: true, data: { key: req.params.type, title: r.title, columns: r.columns, rows: await r.rows(req.query), generatedAt: new Date() } });
});
