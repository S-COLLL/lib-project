// Shared data access, response mappers and library bookkeeping.
// Response shapes match the SmartLib frontend (see frontend/js/demo/demo-api.js).
const { pool } = require('../config/db');
const { fail } = require('./ApiError');

const DAY = 86400000;
const ACTIVE = ['Issued', 'Overdue'];
const STAFF = ['admin', 'librarian', 'staff'];

/* ------------------------------- Formatting ------------------------------- */

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const money = (n) => `${Number(n || 0).toLocaleString('en-US')} Ft`;
const id = (v) => (v === null || v === undefined ? null : String(v));
const code = (prefix, n, width) => `${prefix}${String(n).padStart(width, '0')}`;
const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
const addDays = (d, n) => new Date(new Date(d).getTime() + n * DAY);
const daysBetween = (a, b) => Math.max(0, Math.floor((startOfDay(b) - startOfDay(a)) / DAY));
const isStaff = (u) => STAFF.includes(u.role);
const parseJson = (v, fallback) => {
  if (v === null || v === undefined) return fallback;
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return fallback;
  }
};

function paginate(q, def = 10, max = 200) {
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const limit = Math.min(max, Math.max(1, parseInt(q.limit, 10) || def));
  return { page, limit, offset: (page - 1) * limit };
}
const pageInfo = ({ page, limit }, total) => ({ page, limit, total, pages: Math.ceil(total / limit) || 1 });

/** Assigns a readable code (BK0001, MEM0001 …) from the auto-increment id. */
async function assignCode(db, table, pk, column, prefix, width, rowId) {
  const value = code(prefix, rowId, width);
  await db.query(`UPDATE ${table} SET ${column} = ? WHERE ${pk} = ?`, [value, rowId]);
  return value;
}

/** Assigns the next number of an independent sequence (return codes, receipt numbers). */
async function assignNextCode(db, table, pk, column, prefix, width, rowId) {
  const [[{ n }]] = await db.query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(${column}, ?) AS UNSIGNED)), 0) AS n FROM ${table} WHERE ${column} LIKE ? FOR UPDATE`,
    [prefix.length + 1, `${prefix}%`]
  );
  const value = code(prefix, Number(n) + 1, width);
  await db.query(`UPDATE ${table} SET ${column} = ? WHERE ${pk} = ?`, [value, rowId]);
  return value;
}

/* -------------------------------- Settings -------------------------------- */

const SETTING_DEFAULTS = {
  libraryName: 'SmartLib Central Library',
  finePerDay: 500,
  loanDays: 14,
  maxRenewals: 2,
  maxBooksPerMember: 5,
  maxPendingFine: 500,
  reservationHoldDays: 3,
  reservationValidityDays: 30,
  lostProcessingFee: 500,
  damageChargePercent: 30,
  membershipFee: 2000,
  dueSoonDays: 2,
  backupPath: './backups',
};
const TEXT_SETTINGS = ['libraryName', 'backupPath'];

async function getSettings(db = pool) {
  const [rows] = await db.query('SELECT setting_key, setting_value FROM settings');
  const s = { ...SETTING_DEFAULTS };
  rows.forEach((r) => {
    if (r.setting_key in SETTING_DEFAULTS) s[r.setting_key] = TEXT_SETTINGS.includes(r.setting_key) ? r.setting_value : Number(r.setting_value);
  });
  s.currency = 'Ft';
  return s;
}

/* -------------------------------- Mappers -------------------------------- */

const BOOK_SQL = `
  SELECT b.*, a.name AS author_name, c.name AS category_name,
         s.code AS shelf_code, s.name AS shelf_name, s.floor AS shelf_floor, s.section AS shelf_section
  FROM books b
  JOIN authors a ON a.author_id = b.author_id
  JOIN categories c ON c.category_id = b.category_id
  LEFT JOIN shelves s ON s.shelf_id = b.shelf_id`;

function bookOut(r, { shelfObject = false } = {}) {
  if (!r) return null;
  const location = r.shelf_id
    ? {
        shelf: shelfObject ? { _id: id(r.shelf_id), shelfId: `SH-${r.shelf_code}`, name: r.shelf_name, code: r.shelf_code } : id(r.shelf_id),
        shelfCode: r.shelf_code,
        floor: r.shelf_floor,
        section: r.shelf_section,
        rack: r.rack,
        row: r.shelf_row,
        position: r.position,
      }
    : null;
  return {
    _id: id(r.book_id),
    bookId: r.book_code,
    title: r.title,
    isbn: r.isbn,
    author: id(r.author_id),
    authorName: r.author_name,
    publisher: r.publisher,
    publicationDate: r.publication_date,
    edition: r.edition,
    language: r.language,
    category: id(r.category_id),
    categoryName: r.category_name,
    subcategory: r.subcategory,
    description: r.description || '',
    coverImage: r.cover_image || '',
    pages: r.pages,
    price: r.price,
    purchasePrice: r.purchase_price,
    currentValue: r.current_value,
    quantity: r.quantity,
    availableCopies: r.available_copies,
    issuedCopies: r.issued_copies,
    reservedCopies: r.reserved_copies,
    lostCopies: r.lost_copies,
    damagedCopies: r.damaged_copies,
    status: r.status,
    timesBorrowed: r.times_borrowed,
    location,
    addedBy: id(r.added_by),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const MEMBER_SQL = `
  SELECT m.*,
    (SELECT COUNT(*) FROM loans l WHERE l.member_id = m.member_id AND l.status IN ('Issued','Overdue')) AS books_issued,
    (SELECT COUNT(*) FROM loans l WHERE l.member_id = m.member_id AND l.status IN ('Returned','Damaged','Lost')) AS books_returned,
    (SELECT COALESCE(SUM(f.original_amount - f.discount - f.paid_amount - f.waived_amount), 0) FROM fines f
       WHERE f.member_id = m.member_id AND f.status IN ('Pending','Partially Paid')) AS pending_fine,
    (SELECT COALESCE(SUM(p.amount), 0) FROM fine_payments p
       WHERE p.member_id = m.member_id AND p.fine_id IS NOT NULL AND p.status IN ('Paid','Partially Paid')) AS total_fine_paid
  FROM members m`;

function memberOut(r) {
  if (!r) return null;
  return {
    _id: id(r.member_id),
    memberId: r.member_code,
    name: r.name,
    email: r.email,
    phone: r.phone || '',
    neptunCode: r.neptun_code || '',
    profilePhoto: r.profile_photo || '',
    department: r.department,
    course: r.course,
    year: r.year,
    membershipType: r.membership_type,
    membershipStart: r.membership_start,
    membershipExpiry: r.membership_expiry,
    booksIssued: Number(r.books_issued || 0),
    booksReturned: Number(r.books_returned || 0),
    pendingFine: round2(r.pending_fine),
    totalFinePaid: round2(r.total_fine_paid),
    status: r.status,
    expiryNotified: !!r.expiry_notified,
    user: id(r.user_id),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const LOAN_SQL = `
  SELECT l.*, m.member_code, m.name AS member_name, b.book_code, b.title AS book_title, u.name AS staff_name
  FROM loans l
  JOIN members m ON m.member_id = l.member_id
  JOIN books b ON b.book_id = l.book_id
  LEFT JOIN users u ON u.user_id = l.issued_by`;

function issueOut(r) {
  if (!r) return null;
  return {
    _id: id(r.loan_id),
    transactionId: r.transaction_id,
    member: id(r.member_id),
    book: id(r.book_id),
    memberCode: r.member_code,
    memberName: r.member_name,
    bookCode: r.book_code,
    bookTitle: r.book_title,
    issueDate: r.issue_date,
    dueDate: r.due_date,
    returnDate: r.return_date,
    renewalCount: r.renewal_count,
    staff: id(r.issued_by),
    staffName: r.staff_name || '',
    status: r.status,
    fineAmount: r.fine_amount,
    dueSoonNotified: !!r.due_soon_notified,
    overdueNotified: !!r.overdue_notified,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function returnOut(r) {
  if (!r) return null;
  return {
    _id: id(r.loan_id),
    returnId: r.return_code,
    issue: id(r.loan_id),
    member: id(r.member_id),
    book: id(r.book_id),
    transactionId: r.transaction_id,
    issueDate: r.issue_date,
    dueDate: r.due_date,
    returnDate: r.return_date,
    daysOverdue: r.days_overdue,
    condition: r.return_condition,
    lateFine: r.late_fine,
    damageCharge: r.damage_charge,
    lostCharge: r.lost_charge,
    totalFine: r.fine_amount,
    remarks: r.remarks,
    processedBy: id(r.processed_by),
    createdAt: r.return_date,
    updatedAt: r.updated_at,
  };
}

const RES_SQL = 'SELECT r.* FROM reservations r';
function reservationOut(r) {
  if (!r) return null;
  return {
    _id: id(r.reservation_id),
    reservationId: r.reservation_code,
    member: id(r.member_id),
    book: id(r.book_id),
    reservationDate: r.reservation_date,
    queuePosition: r.queue_position,
    expiryDate: r.expiry_date,
    availableSince: r.available_since,
    status: r.status,
    createdBy: id(r.created_by),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const FINE_SQL = `
  SELECT f.*, l.transaction_id AS loan_txn
  FROM fines f LEFT JOIN loans l ON l.loan_id = f.loan_id`;
const fineRemaining = (f) => round2(Math.max(0, f.original_amount - f.discount - f.paid_amount - f.waived_amount));
function fineOut(r) {
  if (!r) return null;
  return {
    _id: id(r.fine_id),
    fineId: r.fine_code,
    member: id(r.member_id),
    issue: id(r.loan_id),
    book: id(r.book_id),
    transactionId: r.loan_txn || r.transaction_ref || undefined,
    type: r.type,
    description: r.description,
    daysOverdue: r.days_overdue,
    ratePerDay: r.rate_per_day,
    originalAmount: r.original_amount,
    discount: r.discount,
    paidAmount: r.paid_amount,
    waivedAmount: r.waived_amount,
    remainingAmount: fineRemaining(r),
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const PAYMENT_SQL = `
  SELECT p.*, u.name AS collected_by_name
  FROM fine_payments p LEFT JOIN users u ON u.user_id = p.received_by`;
function paymentOut(r) {
  if (!r) return null;
  return {
    _id: id(r.payment_id),
    paymentId: r.payment_code,
    receiptNo: r.receipt_no || undefined,
    member: id(r.member_id),
    fine: id(r.fine_id),
    transactionId: r.transaction_ref || undefined,
    reason: r.reason,
    amount: r.amount,
    date: r.payment_date,
    method: r.method,
    status: r.status,
    reference: r.reference,
    notes: r.notes,
    collectedBy: id(r.received_by),
    collectedByName: r.collected_by_name || '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const SHELF_SQL = `
  SELECT s.*, c.name AS category_name, c.icon AS category_icon,
    COALESCE((SELECT SUM(b.quantity - b.lost_copies) FROM books b WHERE b.shelf_id = s.shelf_id), 0) AS occupied,
    (SELECT COUNT(*) FROM books b WHERE b.shelf_id = s.shelf_id) AS titles
  FROM shelves s LEFT JOIN categories c ON c.category_id = s.category_id`;
function shelfOut(r) {
  if (!r) return null;
  const occupied = Number(r.occupied);
  return {
    _id: id(r.shelf_id),
    id: id(r.shelf_id),
    shelfId: `SH-${r.code}`,
    code: r.code,
    name: r.name,
    floor: r.floor,
    section: r.section,
    racks: r.racks,
    rowsPerRack: r.rows_per_rack,
    category: r.category_id ? { _id: id(r.category_id), name: r.category_name, icon: r.category_icon } : undefined,
    capacity: r.capacity,
    occupied,
    availableSpace: Math.max(0, r.capacity - occupied),
    occupancyPercent: r.capacity ? Math.min(100, Math.round((occupied / r.capacity) * 100)) : 0,
    status: r.status,
    titles: Number(r.titles),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function authorOut(r) {
  return {
    _id: id(r.author_id),
    authorId: r.author_code,
    name: r.name,
    biography: r.biography || '',
    country: r.country,
    profileImage: r.profile_image || '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function categoryOut(r) {
  return {
    _id: id(r.category_id),
    categoryId: r.category_code,
    name: r.name,
    description: r.description,
    icon: r.icon,
    subcategories: parseJson(r.subcategories, []),
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

async function userOut(r, db = pool) {
  if (!r) return null;
  let member = null;
  const [rows] = await db.query(`${MEMBER_SQL} WHERE m.user_id = ?`, [r.user_id]);
  if (rows[0]) member = memberOut(rows[0]);
  return {
    _id: id(r.user_id),
    name: r.name,
    email: r.email,
    role: r.role,
    avatar: r.avatar || '',
    isActive: !!r.is_active,
    searchHistory: parseJson(r.search_history, []),
    lastLogin: r.last_login,
    member,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

/** Pick only the given keys (plus _id) — the demo API's `sel` helper. */
const sel = (o, keys) => (o ? { _id: o._id, ...Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]])) } : null);

/* -------------------------------- Lookups -------------------------------- */

const isPk = (ref) => /^\d{1,9}$/.test(String(ref));

async function findBookRow(db, ref, { lock = false } = {}) {
  if (!ref) fail(400, 'Book is required');
  const r = String(ref).trim();
  const where = isPk(r) ? 'b.book_id = ?' : 'b.book_code = ? OR b.isbn = ?';
  const params = isPk(r) ? [Number(r)] : [r.toUpperCase(), r];
  const [rows] = await db.query(`${BOOK_SQL} WHERE ${where} ${lock ? 'FOR UPDATE' : ''}`, params);
  if (!rows[0]) fail(404, 'Book not found');
  return rows[0];
}

async function findMemberRow(db, ref) {
  if (!ref) fail(400, 'Member is required');
  const r = String(ref).trim();
  const where = isPk(r) ? 'm.member_id = ?' : 'm.member_code = ? OR m.neptun_code = ?';
  const params = isPk(r) ? [Number(r)] : [r.toUpperCase(), r.toUpperCase()];
  const [rows] = await db.query(`${MEMBER_SQL} WHERE ${where}`, params);
  if (!rows[0]) fail(404, 'Member not found');
  return rows[0];
}

async function findShelfRow(db, ref) {
  if (!ref) fail(400, 'Shelf is required');
  const r = String(ref).trim();
  let rows;
  if (isPk(r)) [rows] = await db.query(`${SHELF_SQL} WHERE s.shelf_id = ?`, [Number(r)]);
  if (!rows || !rows[0]) {
    const c = r.toUpperCase().replace(/^SH-/, '').replace(/^SHELF\s+/, '');
    [rows] = await db.query(`${SHELF_SQL} WHERE s.code = ?`, [c]);
  }
  if (!rows[0]) fail(404, 'Shelf not found');
  return rows[0];
}

async function findLoanRow(db, user, ref, { lock = false } = {}) {
  const r = String(ref || '').trim();
  const where = isPk(r) ? 'l.loan_id = ?' : 'l.transaction_id = ?';
  const [rows] = await db.query(`${LOAN_SQL} WHERE ${where} ${lock ? 'FOR UPDATE' : ''}`, [isPk(r) ? Number(r) : r.toUpperCase()]);
  const row = rows[0];
  if (!row || (user.role === 'student' && row.member_id !== user.memberId)) fail(404, 'Transaction not found');
  return row;
}

/* ------------------------------ Bookkeeping ------------------------------ */

async function notify(db, { audience = 'staff', memberId = null, type = 'system', title, message, link = '' }) {
  await db.query('INSERT INTO notifications (audience, member_id, type, title, message, link) VALUES (?, ?, ?, ?, ?, ?)', [
    audience,
    memberId,
    type,
    String(title).slice(0, 150),
    String(message).slice(0, 500),
    link,
  ]);
}

function computeBookStatus(b) {
  if (b.available > 0) return 'Available';
  if (b.reserved > 0) return 'Reserved';
  if (b.issued > 0) return 'Issued';
  if (b.lost >= b.quantity) return 'Lost';
  if (b.damaged > 0) return 'Damaged';
  return 'Unavailable';
}

/** Recomputes a book's copy counters from its loans and reservations. */
async function recalcBook(db, bookId) {
  const [[b]] = await db.query('SELECT quantity, lost_copies, damaged_copies FROM books WHERE book_id = ? FOR UPDATE', [bookId]);
  if (!b) return null;
  const [[{ issued }]] = await db.query(`SELECT COUNT(*) AS issued FROM loans WHERE book_id = ? AND status IN ('Issued','Overdue')`, [bookId]);
  const [[{ reserved }]] = await db.query(`SELECT COUNT(*) AS reserved FROM reservations WHERE book_id = ? AND status = 'Available'`, [bookId]);
  const available = Math.max(0, Math.min(b.quantity, b.quantity - issued - reserved - b.lost_copies - b.damaged_copies));
  const status = computeBookStatus({ available, reserved, issued, lost: b.lost_copies, damaged: b.damaged_copies, quantity: b.quantity });
  await db.query('UPDATE books SET issued_copies = ?, reserved_copies = ?, available_copies = ?, status = ? WHERE book_id = ?', [
    issued,
    reserved,
    available,
    status,
    bookId,
  ]);
  return { available, reserved, issued, status };
}

async function refreshQueuePositions(db, bookId) {
  const [rows] = await db.query(`SELECT reservation_id FROM reservations WHERE book_id = ? AND status = 'Waiting' ORDER BY reservation_date, reservation_id`, [bookId]);
  for (let i = 0; i < rows.length; i += 1) {
    await db.query('UPDATE reservations SET queue_position = ? WHERE reservation_id = ?', [i + 1, rows[i].reservation_id]);
  }
}

/** Gives free copies to the earliest waiting reservations (hold for reservationHoldDays) and notifies them. */
async function processReservationQueue(db, bookId, settings) {
  const s = settings || (await getSettings(db));
  let counts = await recalcBook(db, bookId);
  while (counts && counts.available > 0) {
    const [[next]] = await db.query(
      `SELECT r.reservation_id, r.member_id, m.name, m.member_code, b.title, b.book_code
       FROM reservations r JOIN members m ON m.member_id = r.member_id JOIN books b ON b.book_id = r.book_id
       WHERE r.book_id = ? AND r.status = 'Waiting' ORDER BY r.reservation_date, r.reservation_id LIMIT 1 FOR UPDATE`,
      [bookId]
    );
    if (!next) break;
    const expiry = addDays(new Date(), s.reservationHoldDays);
    await db.query(`UPDATE reservations SET status = 'Available', queue_position = 0, available_since = NOW(), expiry_date = ? WHERE reservation_id = ?`, [
      expiry,
      next.reservation_id,
    ]);
    await notify(db, {
      audience: 'member',
      memberId: next.member_id,
      type: 'reservation',
      title: 'Reserved book is ready',
      message: `"${next.title}" is now available for pickup. Please collect it before ${expiry.toDateString()}.`,
      link: `book-details.html?id=${next.book_code}`,
    });
    await notify(db, {
      type: 'reservation',
      title: 'Reservation ready for pickup',
      message: `${next.name} (${next.member_code}) can now collect "${next.title}".`,
      link: 'reservations.html',
    });
    counts = await recalcBook(db, bookId);
  }
  await refreshQueuePositions(db, bookId);
  return counts;
}

async function refreshFineStatus(db, fineId) {
  const [[f]] = await db.query('SELECT original_amount, discount, paid_amount, waived_amount FROM fines WHERE fine_id = ?', [fineId]);
  if (!f) return;
  const payable = f.original_amount - f.discount;
  let status = 'Pending';
  if (f.paid_amount + f.waived_amount >= payable - 0.001) status = f.waived_amount > 0 ? 'Waived' : 'Paid';
  else if (f.paid_amount > 0) status = 'Partially Paid';
  await db.query('UPDATE fines SET status = ? WHERE fine_id = ?', [status, fineId]);
}

async function assertShelfSpace(db, shelf, extra, excludeBookId = 0) {
  const [[{ used }]] = await db.query('SELECT COALESCE(SUM(quantity - lost_copies), 0) AS used FROM books WHERE shelf_id = ? AND book_id <> ?', [
    shelf.shelf_id,
    excludeBookId,
  ]);
  if (Number(used) + extra > shelf.capacity) fail(400, `${shelf.name} has only ${Math.max(0, shelf.capacity - used)} free slots (needs ${extra})`);
}

module.exports = {
  ACTIVE,
  STAFF,
  DAY,
  round2,
  money,
  id,
  code,
  startOfDay,
  addDays,
  daysBetween,
  isStaff,
  parseJson,
  paginate,
  pageInfo,
  assignCode,
  assignNextCode,
  SETTING_DEFAULTS,
  TEXT_SETTINGS,
  getSettings,
  BOOK_SQL,
  bookOut,
  MEMBER_SQL,
  memberOut,
  LOAN_SQL,
  issueOut,
  returnOut,
  RES_SQL,
  reservationOut,
  FINE_SQL,
  fineRemaining,
  fineOut,
  PAYMENT_SQL,
  paymentOut,
  SHELF_SQL,
  shelfOut,
  authorOut,
  categoryOut,
  userOut,
  sel,
  isPk,
  findBookRow,
  findMemberRow,
  findShelfRow,
  findLoanRow,
  notify,
  recalcBook,
  refreshQueuePositions,
  processReservationQueue,
  refreshFineStatus,
  assertShelfSpace,
};
