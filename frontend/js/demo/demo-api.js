/**
 * SmartLib demo backend — runs entirely in the browser.
 *
 * Used when the frontend is hosted without the Node/MongoDB server (e.g. GitHub Pages).
 * It mirrors the Express REST API (same routes, rules and response shapes) and keeps
 * its data in localStorage, so every visitor gets their own private copy of the library.
 */
import SNAPSHOT from './demo-data.js';

const STORE_KEY = 'smartlib-demo-db-v1';
const DAY = 86400000;
const STAFF = ['admin', 'librarian', 'staff'];
const ACTIVE = ['Issued', 'Overdue'];

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
const fail = (status, message, details) => {
  throw new HttpError(status, message, details);
};

/* =============================== Storage =============================== */

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
function shiftDates(obj, delta) {
  if (Array.isArray(obj)) return obj.forEach((x, i) => (typeof x === 'string' && ISO.test(x) ? (obj[i] = new Date(Date.parse(x) + delta).toISOString()) : shiftDates(x, delta)));
  if (obj && typeof obj === 'object') {
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (typeof v === 'string' && ISO.test(v)) obj[k] = new Date(Date.parse(v) + delta).toISOString();
      else if (v && typeof v === 'object') shiftDates(v, delta);
    }
  }
}

function freshDb() {
  const db = JSON.parse(JSON.stringify(SNAPSHOT));
  // Move the whole timeline so the demo always looks "current"
  shiftDates(db, Date.now() - Date.parse(SNAPSHOT.snapshotAt));
  db.snapshotAt = new Date().toISOString();
  return db;
}

let db;
function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) db = JSON.parse(raw);
  } catch {
    db = null;
  }
  if (!db) db = freshDb();
}
function save() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(db));
  } catch {
    /* quota or private mode — demo continues in memory */
  }
}
export function resetDemo() {
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    /* ignore */
  }
  db = freshDb();
  save();
}

/* =============================== Helpers =============================== */

const clone = (x) => (x === undefined ? x : JSON.parse(JSON.stringify(x)));
const now = () => new Date().toISOString();
const oid = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const escRx = (s = '') => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const startOfDay = (d) => {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
};
const addDays = (d, n) => new Date(new Date(d).getTime() + n * DAY);
const daysBetween = (a, b) => Math.max(0, Math.floor((startOfDay(b) - startOfDay(a)) / DAY));
const isHex24 = (s) => /^[a-f0-9]{24}$/i.test(String(s));
function nextId(name, prefix, width = 4) {
  db.counters[name] = (db.counters[name] || 0) + 1;
  return `${prefix}${String(db.counters[name]).padStart(width, '0')}`;
}
function paginate(q, def = 10, max = 200) {
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const limit = Math.min(max, Math.max(1, parseInt(q.limit, 10) || def));
  return { page, limit, skip: (page - 1) * limit };
}
const pageOf = (list, q, def, max) => {
  const { page, limit, skip } = paginate(q, def, max);
  return { data: list.slice(skip, skip + limit), pagination: { page, limit, total: list.length, pages: Math.ceil(list.length / limit) || 1 } };
};
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => o[k] !== undefined).map((k) => [k, o[k]]));
const byDesc = (f) => (a, b) => (f(b) > f(a) ? 1 : f(b) < f(a) ? -1 : 0);
const byAsc = (f) => (a, b) => (f(a) > f(b) ? 1 : f(a) < f(b) ? -1 : 0);
const sel = (o, keys) => (o ? { _id: o._id, ...pick(o, keys) } : null);
const stamp = (o) => {
  o.updatedAt = now();
  return o;
};
const create = (coll, doc) => {
  const d = { _id: oid(), createdAt: now(), updatedAt: now(), ...doc };
  db[coll].push(d);
  return d;
};

const find = (coll, id) => db[coll].find((x) => x._id === String(id));
function findBy(coll, codeField, ref, label) {
  if (!ref) fail(400, `${label} is required`);
  const r = String(ref).trim();
  const d = isHex24(r) ? find(coll, r) : db[coll].find((x) => String(x[codeField]).toUpperCase() === r.toUpperCase());
  if (!d) fail(404, `${label} not found`);
  return d;
}
const findBook = (ref) => findBy('books', 'bookId', ref, 'Book');
const findMember = (ref) => findBy('members', 'memberId', ref, 'Member');
function findShelf(ref) {
  if (!ref) fail(400, 'Shelf is required');
  if (isHex24(ref) && find('shelves', ref)) return find('shelves', ref);
  const code = String(ref).trim().toUpperCase().replace(/^SH-/, '').replace(/^SHELF\s+/, '');
  const s = db.shelves.find((x) => x.code === code);
  if (!s) fail(404, 'Shelf not found');
  return s;
}

const fineRemaining = (f) => Math.max(0, f.originalAmount - f.discount - f.paidAmount - f.waivedAmount);
const fineOut = (f) => ({ ...clone(f), remainingAmount: fineRemaining(f) });
function refreshFineStatus(f) {
  const payable = f.originalAmount - f.discount;
  if (f.paidAmount + f.waivedAmount >= payable) f.status = f.waivedAmount > 0 ? 'Waived' : 'Paid';
  else if (f.paidAmount > 0) f.status = 'Partially Paid';
  else f.status = 'Pending';
}
const shelfOut = (s) => {
  const o = clone(s);
  o.availableSpace = Math.max(0, s.capacity - s.occupied);
  o.occupancyPercent = s.capacity ? Math.min(100, Math.round((s.occupied / s.capacity) * 100)) : 0;
  o.id = s._id;
  if (s.category) o.category = sel(find('categories', s.category), ['name', 'icon']);
  return o;
};
const userOut = (u) => {
  const o = clone(u);
  delete o.password;
  if (u.member) o.member = clone(find('members', u.member)) || null;
  return o;
};

/* ============================ Library logic ============================ */

function notify({ audience = 'staff', member, type = 'system', title, message, link = '' }) {
  return create('notifications', { audience, member: member || undefined, type, title, message, link, readBy: [] });
}
function computeBookStatus(b) {
  if (b.availableCopies > 0) return 'Available';
  if (b.reservedCopies > 0) return 'Reserved';
  if (b.issuedCopies > 0) return 'Issued';
  if (b.lostCopies >= b.quantity) return 'Lost';
  if (b.damagedCopies > 0) return 'Damaged';
  return 'Unavailable';
}
function recalcBook(bookId) {
  const b = find('books', bookId);
  if (!b) return null;
  b.issuedCopies = db.issues.filter((i) => i.book === b._id && ACTIVE.includes(i.status)).length;
  b.reservedCopies = db.reservations.filter((r) => r.book === b._id && r.status === 'Available').length;
  b.availableCopies = Math.max(0, b.quantity - b.issuedCopies - b.reservedCopies - b.lostCopies - b.damagedCopies);
  b.status = computeBookStatus(b);
  return b;
}
function recalcShelf(shelfId) {
  const s = shelfId && find('shelves', shelfId);
  if (s) s.occupied = Math.max(0, db.books.filter((b) => b.location?.shelf === s._id).reduce((t, b) => t + b.quantity - b.lostCopies, 0));
}
const recalcAllShelves = () => db.shelves.forEach((s) => recalcShelf(s._id));
function syncMember(memberId) {
  const m = find('members', memberId);
  if (!m) return;
  m.booksIssued = db.issues.filter((i) => i.member === m._id && ACTIVE.includes(i.status)).length;
  m.booksReturned = db.issues.filter((i) => i.member === m._id && ['Returned', 'Damaged', 'Lost'].includes(i.status)).length;
  m.pendingFine = db.fines.filter((f) => f.member === m._id && ['Pending', 'Partially Paid'].includes(f.status)).reduce((t, f) => t + fineRemaining(f), 0);
  m.totalFinePaid = db.payments.filter((p) => p.member === m._id && p.fine && ['Paid', 'Partially Paid'].includes(p.status)).reduce((t, p) => t + p.amount, 0);
}
function refreshQueuePositions(bookId) {
  db.reservations
    .filter((r) => r.book === bookId && r.status === 'Waiting')
    .sort(byAsc((r) => r.reservationDate))
    .forEach((r, i) => (r.queuePosition = i + 1));
}
function processReservationQueue(bookId) {
  let book = recalcBook(bookId);
  while (book && book.availableCopies > 0) {
    const next = db.reservations.filter((r) => r.book === bookId && r.status === 'Waiting').sort(byAsc((r) => r.reservationDate))[0];
    if (!next) break;
    const member = find('members', next.member);
    Object.assign(next, { status: 'Available', queuePosition: 0, availableSince: now(), expiryDate: addDays(new Date(), db.settings.reservationHoldDays).toISOString() });
    notify({ audience: 'member', member: next.member, type: 'reservation', title: 'Reserved book is ready', message: `"${book.title}" is now available for pickup. Please collect it before ${new Date(next.expiryDate).toDateString()}.`, link: `book-details.html?id=${book.bookId}` });
    notify({ type: 'reservation', title: 'Reservation ready for pickup', message: `${member?.name} (${member?.memberId}) can now collect "${book.title}".`, link: 'reservations.html' });
    book = recalcBook(bookId);
  }
  refreshQueuePositions(bookId);
  return book;
}
function runMaintenance() {
  const s = db.settings;
  const today = startOfDay(new Date());
  db.issues
    .filter((i) => i.status === 'Issued' && new Date(i.dueDate) < today)
    .forEach((i) => {
      i.status = 'Overdue';
      if (!i.overdueNotified) {
        i.overdueNotified = true;
        notify({ audience: 'member', member: i.member, type: 'overdue', title: 'Book overdue', message: `"${i.bookTitle}" was due on ${new Date(i.dueDate).toDateString()}. A fine of ₹${s.finePerDay}/day applies.`, link: 'issues.html' });
        notify({ type: 'overdue', title: 'Book overdue', message: `${i.memberName} has not returned "${i.bookTitle}" (${i.transactionId}).`, link: 'returns.html' });
      }
      syncMember(i.member);
    });
  db.issues
    .filter((i) => i.status === 'Issued' && !i.dueSoonNotified && new Date(i.dueDate) >= today && new Date(i.dueDate) <= addDays(today, s.dueSoonDays + 1))
    .forEach((i) => {
      i.dueSoonNotified = true;
      notify({ audience: 'member', member: i.member, type: 'due-soon', title: 'Book due soon', message: `"${i.bookTitle}" is due on ${new Date(i.dueDate).toDateString()}. Return or renew it to avoid fines.`, link: 'issues.html' });
    });
  db.members.filter((m) => m.status === 'Active' && new Date(m.membershipExpiry) < new Date()).forEach((m) => (m.status = 'Expired'));
  const touched = new Set();
  db.reservations
    .filter((r) => ['Available', 'Waiting'].includes(r.status) && r.expiryDate && new Date(r.expiryDate) < new Date())
    .forEach((r) => {
      r.status = 'Expired';
      touched.add(r.book);
    });
  touched.forEach(processReservationQueue);
}

/* ============================ Book filtering ============================ */

const SORTS = {
  az: byAsc((b) => b.title.toLowerCase()),
  za: byDesc((b) => b.title.toLowerCase()),
  newest: byDesc((b) => b.createdAt),
  oldest: byAsc((b) => b.createdAt),
  price_asc: byAsc((b) => b.price),
  price_desc: byDesc((b) => b.price),
  popular: (a, b) => b.timesBorrowed - a.timesBorrowed || a.title.localeCompare(b.title),
};

function filterBooks(q = {}) {
  let list = db.books.slice();
  if (q.search) {
    const term = String(q.search).trim();
    const rx = new RegExp(escRx(term), 'i');
    const shelfM = term.match(/^(?:shelf\s*|sh-)?([a-z]{1,2})$/i);
    const rackM = term.match(/^rack\s*(\d+)$/i);
    list = list.filter(
      (b) =>
        [b.title, b.isbn, b.authorName, b.publisher, b.categoryName, b.bookId, b.language, b.subcategory, b.location?.section].some((v) => rx.test(v || '')) ||
        (shelfM && b.location?.shelfCode === shelfM[1].toUpperCase()) ||
        (rackM && b.location?.rack === rackM[1].padStart(2, '0'))
    );
  }
  if (q.category) list = list.filter((b) => (isHex24(q.category) ? b.category === q.category : b.categoryName.toLowerCase() === String(q.category).toLowerCase()));
  if (q.author) list = list.filter((b) => (isHex24(q.author) ? b.author === q.author : new RegExp(escRx(q.author), 'i').test(b.authorName)));
  if (q.language) list = list.filter((b) => b.language.toLowerCase() === String(q.language).toLowerCase());
  if (q.floor) list = list.filter((b) => b.location?.floor === Number(q.floor));
  if (q.shelf) list = list.filter((b) => (isHex24(q.shelf) ? b.location?.shelf === q.shelf : b.location?.shelfCode === String(q.shelf).toUpperCase().replace(/^SH-/, '')));
  if (q.rack) list = list.filter((b) => b.location?.rack === String(q.rack).padStart(2, '0'));
  if (q.minPrice) list = list.filter((b) => b.price >= Number(q.minPrice));
  if (q.maxPrice) list = list.filter((b) => b.price <= Number(q.maxPrice));
  const overdueBooks = new Set(db.issues.filter((i) => i.status === 'Overdue').map((i) => i.book));
  const waiting = new Set(db.reservations.filter((r) => ['Waiting', 'Available'].includes(r.status)).map((r) => r.book));
  const st = String(q.status || '').toLowerCase();
  const tests = {
    available: (b) => b.availableCopies > 0,
    issued: (b) => b.issuedCopies > 0,
    reserved: (b) => b.reservedCopies > 0 || waiting.has(b._id),
    overdue: (b) => overdueBooks.has(b._id),
    lost: (b) => b.lostCopies > 0,
    damaged: (b) => b.damagedCopies > 0,
    unavailable: (b) => b.availableCopies === 0,
  };
  if (tests[st]) list = list.filter(tests[st]);
  return list;
}

/* ================================ Auth ================================ */

function currentUser(token) {
  const id = String(token || '').replace(/^demo\./, '');
  const u = find('users', id);
  if (!u || !u.isActive) fail(401, 'Not authenticated. Please log in.');
  return u;
}
const isStaff = (u) => STAFF.includes(u.role);
const need = (u, ...roles) => {
  if (!roles.includes(u.role)) fail(403, `This action requires one of the roles: ${roles.join(', ')}`);
};
const needStaff = (u) => need(u, ...STAFF);
const scope = (u, list) => (u.role === 'student' ? list.filter((x) => x.member === u.member) : list);
const required = (body, fields) => {
  const errors = {};
  Object.entries(fields).forEach(([k, label]) => {
    if (body[k] === undefined || body[k] === null || body[k] === '') errors[k] = `${label} is required`;
  });
  if (Object.keys(errors).length) fail(400, Object.values(errors)[0], errors);
};
const validEmail = (e) => /^\S+@\S+\.\S+$/.test(String(e || ''));

/* ============================== Handlers ============================== */

const routes = [];
const on = (method, pattern, handler, { open = false } = {}) => {
  const keys = [];
  const rx = new RegExp(`^${pattern.replace(/:(\w+)/g, (_, k) => (keys.push(k), '([^/]+)'))}$`);
  routes.push({ method, rx, keys, handler, open });
};

/* ---- auth ---- */
on('POST', '/auth/login', ({ body }) => {
  const u = db.users.find((x) => x.email === String(body.email || '').toLowerCase());
  if (!u || u.password !== body.password) fail(401, 'Invalid email or password');
  if (!u.isActive) fail(403, 'This account has been disabled');
  u.lastLogin = now();
  return { success: true, token: `demo.${u._id}`, user: userOut(u) };
}, { open: true });

on('POST', '/auth/register', ({ body }) => {
  required(body, { name: 'Name', email: 'Email', password: 'Password' });
  if (!validEmail(body.email)) fail(400, 'Email is invalid', { email: 'Email is invalid' });
  if (String(body.password).length < 6) fail(400, 'Password must be at least 6 characters', { password: 'Password must be at least 6 characters' });
  const email = body.email.toLowerCase();
  if (db.users.some((u) => u.email === email)) fail(409, 'An account with this email already exists');
  let m = db.members.find((x) => x.email === email);
  if (!m) m = create('members', { memberId: nextId('member', 'MEM'), name: body.name, email, phone: body.phone || undefined, profilePhoto: '', department: body.department || '', course: body.course || '', year: body.year || '', membershipType: 'Student', membershipStart: now(), membershipExpiry: addDays(new Date(), 365).toISOString(), booksIssued: 0, booksReturned: 0, pendingFine: 0, totalFinePaid: 0, status: 'Active', expiryNotified: false });
  const u = create('users', { name: body.name, email, password: body.password, role: 'student', member: m._id, avatar: '', isActive: true, searchHistory: [] });
  m.user = u._id;
  notify({ type: 'system', title: 'New member registered', message: `${body.name} (${m.memberId}) created an account.`, link: 'members.html' });
  return { success: true, token: `demo.${u._id}`, user: userOut(u) };
}, { open: true });

on('GET', '/auth/me', ({ user }) => ({ success: true, user: userOut(user) }));
on('PUT', '/auth/profile', ({ user, body }) => {
  if (body.name !== undefined) user.name = body.name;
  if (body.avatar !== undefined) user.avatar = body.avatar;
  const m = user.member && find('members', user.member);
  if (m) Object.assign(m, body.name ? { name: body.name } : {}, body.avatar !== undefined ? { profilePhoto: body.avatar } : {});
  return { success: true, user: userOut(stamp(user)) };
});
on('PATCH', '/auth/password', ({ user, body }) => {
  if (user.password !== body.currentPassword) fail(400, 'Current password is incorrect', { currentPassword: 'Current password is incorrect' });
  if (!body.newPassword || body.newPassword.length < 6) fail(400, 'New password must be at least 6 characters');
  user.password = body.newPassword;
  return { success: true, message: 'Password updated' };
});
on('POST', '/auth/search-history', ({ user, body }) => {
  const term = String(body.term || '').trim().slice(0, 60);
  if (term.length >= 2) user.searchHistory = [term, ...(user.searchHistory || []).filter((t) => t.toLowerCase() !== term.toLowerCase())].slice(0, 20);
  return { success: true, searchHistory: user.searchHistory };
});
on('GET', '/auth/users', ({ user }) => {
  need(user, 'admin');
  return { success: true, data: db.users.slice().sort(byDesc((u) => u.createdAt)).map((u) => ({ ...userOut(u), member: u.member ? sel(find('members', u.member), ['memberId', 'name']) : undefined })) };
});
on('POST', '/auth/users', ({ user, body }) => {
  need(user, 'admin');
  required(body, { name: 'Name', email: 'Email', password: 'Password', role: 'Role' });
  const email = body.email.toLowerCase();
  if (db.users.some((u) => u.email === email)) fail(409, 'An account with this email already exists');
  let member;
  if (body.role === 'student') {
    member = db.members.find((m) => m.email === email);
    if (!member) fail(400, 'Create the library member first; student accounts must match a member email');
  }
  const u = create('users', { name: body.name, email, password: body.password, role: body.role, member: member?._id, avatar: '', isActive: true, searchHistory: [] });
  if (member) member.user = u._id;
  return { success: true, data: userOut(u) };
});
on('PATCH', '/auth/users/:id', ({ user, params, body }) => {
  need(user, 'admin');
  const u = find('users', params.id) || fail(404, 'User not found');
  if (u._id === user._id && (body.role || body.isActive === false)) fail(400, 'You cannot change your own role or disable your own account');
  Object.assign(u, pick(body, ['name', 'role', 'isActive']));
  if (body.password) u.password = body.password;
  return { success: true, data: userOut(stamp(u)) };
});

/* ---- books ---- */
on('GET', '/books', ({ query }) => {
  const list = filterBooks(query).sort(SORTS[query.sort] || SORTS.newest);
  const res = pageOf(list, query, 12, 500);
  const overdue = new Set(db.issues.filter((i) => i.status === 'Overdue').map((i) => i.book));
  res.data = res.data.map((b) => ({ ...clone(b), hasOverdue: overdue.has(b._id), location: { ...b.location, shelf: sel(find('shelves', b.location?.shelf), ['shelfId', 'name', 'code']) } }));
  return { success: true, ...res };
});
on('GET', '/books/meta', () => ({
  success: true,
  data: {
    languages: [...new Set(db.books.map((b) => b.language))].sort(),
    publishers: [...new Set(db.books.map((b) => b.publisher).filter(Boolean))].sort(),
    categories: db.categories.map((c) => sel(c, ['name'])).sort(byAsc((c) => c.name)),
    floors: [...new Set(db.shelves.map((s) => s.floor))].sort((a, b) => a - b),
  },
}));
on('GET', '/books/recommendations', ({ user, query }) => {
  let memberId = user.member;
  if (user.role !== 'student' && query.member) memberId = db.members.find((m) => m._id === query.member || m.memberId === String(query.member).toUpperCase())?._id;
  const history = memberId ? db.issues.filter((i) => i.member === memberId) : [];
  const read = new Set(history.map((h) => h.book));
  const catScore = {};
  const authScore = {};
  history.forEach((h) => {
    const b = find('books', h.book);
    if (!b) return;
    catScore[b.category] = (catScore[b.category] || 0) + 1;
    authScore[b.author] = (authScore[b.author] || 0) + 1;
  });
  const terms = (user.searchHistory || []).slice(0, 5);
  const termRx = terms.map((t) => new RegExp(escRx(t), 'i'));
  const cands = db.books.filter((b) => !read.has(b._id));
  const maxB = Math.max(1, ...cands.map((b) => b.timesBorrowed));
  const scored = cands.map((b) => {
    let score = (b.timesBorrowed / maxB) * 2;
    const reasons = [];
    if (catScore[b.category]) {
      score += catScore[b.category] * 2;
      reasons.push(`Because you read ${b.categoryName}`);
    }
    if (authScore[b.author]) {
      score += authScore[b.author] * 3;
      reasons.push(`More by ${b.authorName}`);
    }
    if (termRx.some((rx) => rx.test(b.title) || rx.test(b.authorName) || rx.test(b.categoryName))) {
      score += 2.5;
      reasons.push('Matches your searches');
    }
    if (b.availableCopies > 0) score += 0.5;
    if (!reasons.length) reasons.push(b.timesBorrowed > maxB / 2 ? 'Popular in the library' : 'Trending pick');
    return { ...clone(b), score, reason: reasons[0] };
  });
  scored.sort((a, b) => b.score - a.score);
  return { success: true, data: scored.slice(0, Number(query.limit) || 8), basedOn: { borrowed: history.length, searches: terms } };
});
on('GET', '/books/:id', ({ user, params }) => {
  const ref = decodeURIComponent(params.id);
  const b = find('books', ref) || db.books.find((x) => x.bookId === ref.toUpperCase() || x.isbn === ref) || fail(404, 'Book not found');
  const out = clone(b);
  out.author = clone(find('authors', b.author));
  out.category = sel(find('categories', b.category), ['name', 'icon', 'categoryId']);
  out.location = { ...b.location, shelf: clone(find('shelves', b.location?.shelf)) };
  const activeIssues = db.issues.filter((i) => i.book === b._id && ACTIVE.includes(i.status)).sort(byAsc((i) => i.dueDate));
  const queue = db.reservations
    .filter((r) => r.book === b._id && ['Waiting', 'Available'].includes(r.status))
    .sort((a, c) => a.status.localeCompare(c.status) || a.reservationDate.localeCompare(c.reservationDate))
    .map((r) => ({ ...clone(r), member: sel(find('members', r.member), ['memberId', 'name']) }));
  const similar = db.books.filter((x) => x._id !== b._id && (x.category === b.category || x.author === b.author)).sort(byDesc((x) => x.timesBorrowed)).slice(0, 6);
  const staff = isStaff(user);
  return {
    success: true,
    data: out,
    activeIssues: clone(staff ? activeIssues : activeIssues.filter((i) => i.member === user.member)),
    nextDue: activeIssues[0]?.dueDate || null,
    reservations: staff ? queue : queue.filter((r) => r.member?._id === user.member),
    queueLength: queue.filter((r) => r.status === 'Waiting').length,
    similar: clone(similar),
  };
});

function resolveAuthor(body) {
  if (body.author && isHex24(body.author)) return find('authors', body.author) || fail(400, 'Selected author does not exist');
  const name = String(body.authorName || body.author || '').trim();
  if (!name) fail(400, 'Author is required', { authorName: 'Author is required' });
  return db.authors.find((a) => a.name.toLowerCase() === name.toLowerCase()) || create('authors', { authorId: nextId('author', 'AUT', 3), name, biography: '', country: '', profileImage: '' });
}
function resolveCategory(body) {
  const ref = body.category || body.categoryName;
  if (!ref) fail(400, 'Category is required', { category: 'Category is required' });
  return (isHex24(ref) ? find('categories', ref) : db.categories.find((c) => c.name.toLowerCase() === String(ref).toLowerCase())) || fail(400, 'Selected category does not exist');
}
function applyLocation(book, loc) {
  if (!loc || !loc.shelf) fail(400, 'Shelf location is required', { shelf: 'Shelf is required' });
  const s = findShelf(loc.shelf);
  const rack = String(loc.rack || '').trim();
  const row = String(loc.row || '').trim().toUpperCase();
  const position = String(loc.position || '').trim();
  if (!rack || !row || !position) fail(400, 'Rack, row and position are required');
  if (!/^\d{1,3}$/.test(rack) || Number(rack) < 1 || Number(rack) > s.racks) fail(400, `Rack must be between 1 and ${s.racks} for ${s.name}`, { rack: `1–${s.racks}` });
  if (!/^[A-Z]$/.test(row) || row.charCodeAt(0) - 64 > s.rowsPerRack) fail(400, `Row must be between A and ${String.fromCharCode(64 + s.rowsPerRack)} for ${s.name}`);
  if (!/^\d{1,3}$/.test(position) || Number(position) < 1) fail(400, 'Position must be a positive number', { position: 'Must be a positive number' });
  book.location = { shelf: s._id, shelfCode: s.code, floor: s.floor, section: s.section, rack: rack.padStart(2, '0'), row, position: position.padStart(2, '0') };
  return s;
}
function assertShelfSpace(s, extra, excludeId) {
  const used = db.books.filter((b) => b.location?.shelf === s._id && b._id !== excludeId).reduce((t, b) => t + b.quantity - b.lostCopies, 0);
  if (used + extra > s.capacity) fail(400, `${s.name} has only ${Math.max(0, s.capacity - used)} free slots (needs ${extra})`);
}
const BOOK_FIELDS = ['title', 'isbn', 'publisher', 'publicationDate', 'edition', 'language', 'subcategory', 'description', 'coverImage', 'pages', 'price', 'purchasePrice', 'currentValue', 'quantity', 'lostCopies', 'damagedCopies'];
const NUM_FIELDS = ['pages', 'price', 'purchasePrice', 'currentValue', 'quantity', 'lostCopies', 'damagedCopies'];
function validateBook(body, partial) {
  const errors = {};
  if (!partial || body.title !== undefined) if (!String(body.title || '').trim()) errors.title = 'Book name is required';
  if (!partial || body.isbn !== undefined) if (!/^(97[89])?\d{9}[\dX]$/.test(String(body.isbn || ''))) errors.isbn = 'ISBN must be a valid ISBN-10 or ISBN-13 (digits only)';
  if (!partial || body.price !== undefined) if (!(Number(body.price) >= 0) || body.price === '') errors.price = 'Price is required';
  if (!partial || body.quantity !== undefined) if (!(Number(body.quantity) >= 1)) errors.quantity = 'Quantity must be at least 1';
  if (Object.keys(errors).length) fail(400, Object.values(errors)[0], errors);
  NUM_FIELDS.forEach((k) => body[k] !== undefined && body[k] !== '' && (body[k] = Number(body[k])));
}

on('POST', '/books', ({ user, body }) => {
  need(user, 'admin', 'librarian');
  validateBook(body, false);
  if (db.books.some((b) => b.isbn === body.isbn)) fail(409, 'A record with this isbn already exists');
  const a = resolveAuthor(body);
  const c = resolveCategory(body);
  const book = { lostCopies: 0, damagedCopies: 0, pages: 0, purchasePrice: 0, edition: '1st', language: 'English', subcategory: '', description: '', coverImage: '', publisher: '', ...pick(body, BOOK_FIELDS) };
  const s = applyLocation(book, body.location);
  assertShelfSpace(s, book.quantity - book.lostCopies);
  Object.assign(book, { bookId: nextId('book', 'BK'), author: a._id, authorName: a.name, category: c._id, categoryName: c.name, currentValue: book.currentValue || book.price, timesBorrowed: 0, issuedCopies: 0, reservedCopies: 0, addedBy: user._id });
  const doc = create('books', book);
  recalcBook(doc._id);
  recalcShelf(s._id);
  notify({ audience: 'all', type: 'new-book', title: 'New book added', message: `"${doc.title}" by ${a.name} is now in ${c.name} — Floor ${doc.location.floor}, Shelf ${doc.location.shelfCode}.`, link: `book-details.html?id=${doc.bookId}` });
  return { success: true, data: clone(doc) };
});
on('PUT', '/books/:id', ({ user, params, body }) => {
  need(user, 'admin', 'librarian');
  const b = findBook(params.id);
  validateBook(body, true);
  if (body.isbn && db.books.some((x) => x.isbn === body.isbn && x._id !== b._id)) fail(409, 'A record with this isbn already exists');
  const oldShelf = b.location?.shelf;
  const next = { ...b, ...pick(body, BOOK_FIELDS) };
  if (body.author || body.authorName) {
    const a = resolveAuthor(body);
    Object.assign(next, { author: a._id, authorName: a.name });
  }
  if (body.category || body.categoryName) {
    const c = resolveCategory(body);
    Object.assign(next, { category: c._id, categoryName: c.name });
  }
  let s = null;
  if (body.location) s = applyLocation(next, body.location);
  const active = db.issues.filter((i) => i.book === b._id && ACTIVE.includes(i.status)).length;
  if (next.quantity < active + next.lostCopies + next.damagedCopies) fail(400, `Quantity cannot be lower than issued (${active}) + lost + damaged copies`);
  if (s) assertShelfSpace(s, next.quantity - next.lostCopies, b._id);
  Object.assign(b, next);
  stamp(b);
  const updated = processReservationQueue(b._id);
  recalcShelf(b.location.shelf);
  if (oldShelf !== b.location.shelf) recalcShelf(oldShelf);
  return { success: true, data: clone(updated) };
});
on('PATCH', '/books/:id/location', ({ user, params, body }) => {
  needStaff(user);
  const b = findBook(params.id);
  const oldShelf = b.location?.shelf;
  const tmp = { ...b };
  const s = applyLocation(tmp, body);
  if (oldShelf !== s._id) assertShelfSpace(s, b.quantity - b.lostCopies, b._id);
  b.location = tmp.location;
  stamp(b);
  recalcShelf(s._id);
  if (oldShelf !== s._id) recalcShelf(oldShelf);
  const l = b.location;
  notify({ type: 'system', title: 'Book moved', message: `"${b.title}" moved to Floor ${l.floor}, ${l.section}, Shelf ${l.shelfCode}, Rack ${l.rack}, Row ${l.row}, Position ${l.position}.`, link: `book-details.html?id=${b.bookId}` });
  return { success: true, data: clone(b) };
});
function deleteBook(b) {
  const active = db.issues.filter((i) => i.book === b._id && ACTIVE.includes(i.status)).length;
  if (active) fail(400, `"${b.title}" has ${active} copy(s) currently issued and cannot be deleted`);
  db.reservations.filter((r) => r.book === b._id && ['Waiting', 'Available'].includes(r.status)).forEach((r) => (r.status = 'Cancelled'));
  db.books = db.books.filter((x) => x._id !== b._id);
  recalcShelf(b.location?.shelf);
}
on('DELETE', '/books/:id', ({ user, params }) => {
  need(user, 'admin', 'librarian');
  deleteBook(findBook(params.id));
  return { success: true, message: 'Book deleted' };
});
on('POST', '/books/bulk', ({ user, body }) => {
  need(user, 'admin', 'librarian');
  if (!Array.isArray(body.ids) || !body.ids.length) fail(400, 'Select at least one book');
  const books = db.books.filter((b) => body.ids.includes(b._id));
  const results = { ok: 0, failed: [] };
  if (body.action === 'delete') {
    books.forEach((b) => {
      try {
        deleteBook(b);
        results.ok += 1;
      } catch (e) {
        results.failed.push({ id: b.bookId, reason: e.message });
      }
    });
  } else if (body.action === 'category') {
    const c = resolveCategory(body);
    books.forEach((b) => Object.assign(stamp(b), { category: c._id, categoryName: c.name }));
    results.ok = books.length;
  } else if (body.action === 'move') {
    const s = findShelf(body.shelf);
    assertShelfSpace(s, books.filter((b) => b.location?.shelf !== s._id).reduce((t, b) => t + b.quantity - b.lostCopies, 0));
    const old = new Set(books.map((b) => b.location?.shelf));
    books.forEach((b) => {
      b.location = { ...b.location, shelf: s._id, shelfCode: s.code, floor: s.floor, section: s.section };
      stamp(b);
    });
    results.ok = books.length;
    [...old, s._id].forEach(recalcShelf);
  } else fail(400, 'Unknown bulk action');
  return { success: true, data: results, message: `${results.ok} book(s) updated${results.failed.length ? `, ${results.failed.length} skipped` : ''}` };
});

/* ---- authors ---- */
const authorStats = (a) => {
  const bs = db.books.filter((b) => b.author === a._id);
  return { ...clone(a), bookCount: bs.length, totalCopies: bs.reduce((t, b) => t + b.quantity, 0), timesBorrowed: bs.reduce((t, b) => t + b.timesBorrowed, 0) };
};
on('GET', '/authors', ({ query }) => {
  const rx = query.search ? new RegExp(escRx(query.search), 'i') : null;
  return { success: true, data: db.authors.filter((a) => !rx || rx.test(a.name)).sort(byAsc((a) => a.name)).map(authorStats) };
});
on('GET', '/authors/:id', ({ params }) => {
  const a = findBy('authors', 'authorId', params.id, 'Author');
  const books = db.books.filter((b) => b.author === a._id).sort(byAsc((b) => b.title));
  return { success: true, data: { ...clone(a), bookCount: books.length }, books: clone(books) };
});
on('POST', '/authors', ({ user, body }) => {
  need(user, 'admin', 'librarian');
  required(body, { name: 'Name' });
  if (db.authors.some((a) => a.name.toLowerCase() === body.name.toLowerCase())) fail(409, 'An author with this name already exists');
  return { success: true, data: clone(create('authors', { authorId: nextId('author', 'AUT', 3), biography: '', country: '', profileImage: '', ...pick(body, ['name', 'biography', 'country', 'profileImage']) })) };
});
on('PUT', '/authors/:id', ({ user, params, body }) => {
  need(user, 'admin', 'librarian');
  const a = findBy('authors', 'authorId', params.id, 'Author');
  Object.assign(stamp(a), pick(body, ['name', 'biography', 'country', 'profileImage']));
  if (body.name) db.books.filter((b) => b.author === a._id).forEach((b) => (b.authorName = a.name));
  return { success: true, data: clone(a) };
});
on('DELETE', '/authors/:id', ({ user, params }) => {
  need(user, 'admin', 'librarian');
  const a = findBy('authors', 'authorId', params.id, 'Author');
  const n = db.books.filter((b) => b.author === a._id).length;
  if (n) fail(400, `Cannot delete: ${n} book(s) are linked to this author`);
  db.authors = db.authors.filter((x) => x._id !== a._id);
  return { success: true, message: 'Author deleted' };
});

/* ---- categories ---- */
on('GET', '/categories', () => ({
  success: true,
  data: db.categories
    .slice()
    .sort(byAsc((c) => c.name))
    .map((c) => {
      const bs = db.books.filter((b) => b.category === c._id);
      const sum = (k) => bs.reduce((t, b) => t + b[k], 0);
      return { ...clone(c), titles: bs.length, totalBooks: sum('quantity'), availableBooks: sum('availableCopies'), issuedBooks: sum('issuedCopies'), reservedBooks: sum('reservedCopies') };
    }),
}));
on('GET', '/categories/:id', ({ params }) => {
  const c = findBy('categories', 'categoryId', params.id, 'Category');
  return { success: true, data: clone(c), books: clone(db.books.filter((b) => b.category === c._id)) };
});
on('POST', '/categories', ({ user, body }) => {
  need(user, 'admin', 'librarian');
  required(body, { name: 'Name' });
  if (db.categories.some((c) => c.name.toLowerCase() === body.name.toLowerCase())) fail(409, 'A record with this name already exists');
  return { success: true, data: clone(create('categories', { categoryId: nextId('category', 'CAT', 3), description: '', icon: '📚', subcategories: [], ...pick(body, ['name', 'description', 'icon', 'subcategories']) })) };
});
on('PUT', '/categories/:id', ({ user, params, body }) => {
  need(user, 'admin', 'librarian');
  const c = findBy('categories', 'categoryId', params.id, 'Category');
  Object.assign(stamp(c), pick(body, ['name', 'description', 'icon', 'subcategories']));
  if (body.name) db.books.filter((b) => b.category === c._id).forEach((b) => (b.categoryName = c.name));
  return { success: true, data: clone(c) };
});
on('DELETE', '/categories/:id', ({ user, params }) => {
  need(user, 'admin', 'librarian');
  const c = findBy('categories', 'categoryId', params.id, 'Category');
  const n = db.books.filter((b) => b.category === c._id).length;
  if (n) fail(400, `Cannot delete: ${n} book(s) belong to this category`);
  db.shelves.filter((s) => s.category === c._id).forEach((s) => delete s.category);
  db.categories = db.categories.filter((x) => x._id !== c._id);
  return { success: true, message: 'Category deleted' };
});

/* ---- shelves ---- */
on('GET', '/shelves', ({ query }) => {
  recalcAllShelves();
  const list = db.shelves.filter((s) => !query.floor || s.floor === Number(query.floor)).sort((a, b) => a.floor - b.floor || a.section.localeCompare(b.section) || a.code.localeCompare(b.code));
  return { success: true, data: list.map((s) => ({ ...shelfOut(s), titles: db.books.filter((b) => b.location?.shelf === s._id).length })) };
});
on('GET', '/shelves/:id', ({ params }) => {
  const s = findShelf(params.id);
  recalcShelf(s._id);
  const books = db.books.filter((b) => b.location?.shelf === s._id).sort((a, b) => (a.location.rack + a.location.row + a.location.position).localeCompare(b.location.rack + b.location.row + b.location.position));
  return { success: true, data: { ...shelfOut(s), titles: books.length }, books: clone(books) };
});
function shelfBody(body) {
  const b = pick(body, ['code', 'name', 'floor', 'section', 'racks', 'rowsPerRack', 'category', 'capacity', 'status']);
  ['floor', 'racks', 'rowsPerRack', 'capacity'].forEach((k) => b[k] !== undefined && (b[k] = Number(b[k])));
  if (b.code) b.code = String(b.code).toUpperCase();
  if (b.category === '') b.category = undefined;
  if (b.category && !find('categories', b.category)) fail(400, 'Category does not exist');
  return b;
}
on('POST', '/shelves', ({ user, body }) => {
  need(user, 'admin', 'librarian');
  required(body, { code: 'Shelf code', floor: 'Floor', section: 'Section', capacity: 'Capacity' });
  const b = shelfBody(body);
  if (db.shelves.some((s) => s.code === b.code)) fail(409, 'A record with this code already exists');
  const s = create('shelves', { racks: 4, rowsPerRack: 4, status: 'Active', occupied: 0, ...b, shelfId: `SH-${b.code}`, name: b.name || `Shelf ${b.code}` });
  return { success: true, data: shelfOut(s) };
});
on('PUT', '/shelves/:id', ({ user, params, body }) => {
  need(user, 'admin', 'librarian');
  const s = findShelf(params.id);
  const b = shelfBody(body);
  if (b.capacity !== undefined && b.capacity < s.occupied) fail(400, `Capacity cannot be less than the ${s.occupied} books currently stored`, { capacity: `At least ${s.occupied}` });
  if (b.code && b.code !== s.code) {
    if (db.shelves.some((x) => x.code === b.code)) fail(409, 'A record with this code already exists');
    b.shelfId = `SH-${b.code}`;
    if (!b.name) b.name = `Shelf ${b.code}`;
  }
  Object.assign(stamp(s), b);
  db.books.filter((x) => x.location?.shelf === s._id).forEach((x) => Object.assign(x.location, { shelfCode: s.code, floor: s.floor, section: s.section }));
  return { success: true, data: shelfOut(s) };
});
on('DELETE', '/shelves/:id', ({ user, params }) => {
  need(user, 'admin', 'librarian');
  const s = findShelf(params.id);
  const n = db.books.filter((b) => b.location?.shelf === s._id).length;
  if (n) fail(400, `Cannot delete: ${n} book title(s) are stored on ${s.name}. Move them first.`);
  db.shelves = db.shelves.filter((x) => x._id !== s._id);
  return { success: true, message: 'Shelf deleted' };
});

/* ---- members ---- */
const MEMBER_FIELDS = ['name', 'email', 'phone', 'profilePhoto', 'department', 'course', 'year', 'membershipType', 'membershipStart', 'membershipExpiry', 'status'];
function validateMember(body, partial) {
  const e = {};
  if ((!partial || body.name !== undefined) && String(body.name || '').trim().length < 2) e.name = 'Name must be at least 2 characters';
  if ((!partial || body.email !== undefined) && !validEmail(body.email)) e.email = 'Email is invalid';
  if (body.phone && !/^[+\d][\d\s-]{7,15}$/.test(body.phone)) e.phone = 'Phone number is invalid';
  if (Object.keys(e).length) fail(400, Object.values(e)[0], e);
}
on('GET', '/members', ({ user, query }) => {
  needStaff(user);
  let list = db.members.slice();
  if (query.search) {
    const rx = new RegExp(escRx(query.search), 'i');
    list = list.filter((m) => [m.name, m.email, m.memberId, m.phone, m.department, m.course].some((v) => rx.test(v || '')));
  }
  if (query.status) list = list.filter((m) => m.status === query.status);
  if (query.type) list = list.filter((m) => m.membershipType === query.type);
  const sorts = { name: byAsc((m) => m.name), fine: byDesc((m) => m.pendingFine), expiry: byAsc((m) => m.membershipExpiry) };
  list.sort(sorts[query.sort] || byDesc((m) => m.createdAt));
  const res = pageOf(list, query, 12, 500);
  return { success: true, data: clone(res.data), pagination: res.pagination };
});
on('GET', '/members/:id', ({ user, params }) => {
  const m = findMember(params.id);
  if (user.role === 'student' && user.member !== m._id) fail(403, 'You can only view your own membership');
  syncMember(m._id);
  const issues = db.issues.filter((i) => i.member === m._id).sort(byDesc((i) => i.issueDate)).map((i) => ({ ...clone(i), book: sel(find('books', i.book), ['bookId', 'title', 'coverImage', 'isbn', 'authorName']) }));
  return {
    success: true,
    data: clone(m),
    issues,
    fines: db.fines.filter((f) => f.member === m._id).sort(byDesc((f) => f.createdAt)).map(fineOut),
    payments: clone(db.payments.filter((p) => p.member === m._id).sort(byDesc((p) => p.date))),
    reservations: db.reservations.filter((r) => r.member === m._id).sort(byDesc((r) => r.reservationDate)).map((r) => ({ ...clone(r), book: sel(find('books', r.book), ['bookId', 'title']) })),
  };
});
function membershipPayment(user, m, reason, amount, method) {
  return create('payments', { paymentId: nextId('payment', 'PAY', 5), receiptNo: nextId('receipt', 'RCPT-', 6), member: m._id, reason, amount, date: now(), method, status: 'Paid', reference: `DEMO-${oid().slice(0, 8).toUpperCase()}`, notes: '', collectedBy: user._id, collectedByName: user.name });
}
on('POST', '/members', ({ user, body }) => {
  needStaff(user);
  validateMember(body, false);
  const d = pick(body, MEMBER_FIELDS);
  d.email = d.email.toLowerCase();
  if (db.members.some((m) => m.email === d.email)) fail(409, 'A record with this email already exists');
  d.membershipStart = d.membershipStart ? new Date(d.membershipStart).toISOString() : now();
  d.membershipExpiry = d.membershipExpiry ? new Date(d.membershipExpiry).toISOString() : addDays(d.membershipStart, 365).toISOString();
  if (d.membershipExpiry <= d.membershipStart) fail(400, 'Expiry date must be after the start date');
  const m = create('members', { profilePhoto: '', department: '', course: '', year: '', membershipType: 'Student', status: 'Active', booksIssued: 0, booksReturned: 0, pendingFine: 0, totalFinePaid: 0, expiryNotified: false, ...d, memberId: nextId('member', 'MEM') });
  if (body.collectFee) membershipPayment(user, m, 'Membership Fee', Number(body.feeAmount) || db.settings.membershipFee, body.feeMethod || 'Cash');
  notify({ type: 'system', title: 'New member added', message: `${m.name} (${m.memberId}) joined as ${m.membershipType}.`, link: 'members.html' });
  return { success: true, data: clone(m) };
});
on('PUT', '/members/:id', ({ user, params, body }) => {
  needStaff(user);
  const m = findMember(params.id);
  validateMember(body, true);
  const d = pick(body, MEMBER_FIELDS);
  ['membershipStart', 'membershipExpiry'].forEach((k) => d[k] && (d[k] = new Date(d[k]).toISOString()));
  const next = { ...m, ...d };
  if (next.membershipExpiry <= next.membershipStart) fail(400, 'Expiry date must be after the start date');
  if (d.membershipExpiry && new Date(d.membershipExpiry) > new Date()) {
    next.expiryNotified = false;
    if (next.status === 'Expired' && !body.status) next.status = 'Active';
  }
  Object.assign(stamp(m), next);
  const u = m.user && find('users', m.user);
  if (u) Object.assign(u, { name: m.name, email: m.email });
  return { success: true, data: clone(m) };
});
on('PATCH', '/members/:id/renew', ({ user, params, body }) => {
  needStaff(user);
  const m = findMember(params.id);
  const months = Math.min(60, Math.max(1, Number(body.months) || 12));
  const base = new Date(m.membershipExpiry) > new Date() ? new Date(m.membershipExpiry) : new Date();
  base.setMonth(base.getMonth() + months);
  Object.assign(stamp(m), { membershipExpiry: base.toISOString(), expiryNotified: false, status: m.status === 'Expired' ? 'Active' : m.status });
  const payment = body.collectFee !== false ? membershipPayment(user, m, `Membership Renewal (${months} months)`, Number(body.amount) || Math.round((db.settings.membershipFee * months) / 12), body.method || 'Cash') : null;
  notify({ audience: 'member', member: m._id, type: 'membership', title: 'Membership renewed', message: `Your membership is valid until ${base.toDateString()}.` });
  return { success: true, data: clone(m), payment: clone(payment) };
});
on('DELETE', '/members/:id', ({ user, params }) => {
  need(user, 'admin', 'librarian');
  const m = findMember(params.id);
  const active = db.issues.filter((i) => i.member === m._id && ACTIVE.includes(i.status)).length;
  if (active) fail(400, `Member has ${active} book(s) still issued. Collect them before deleting.`);
  syncMember(m._id);
  if (m.pendingFine > 0) fail(400, `Member has ₹${m.pendingFine} pending fines. Settle or waive them first.`);
  db.reservations.filter((r) => r.member === m._id && ['Waiting', 'Available'].includes(r.status)).forEach((r) => (r.status = 'Cancelled'));
  const u = m.user && find('users', m.user);
  if (u) {
    u.isActive = false;
    delete u.member;
  }
  db.members = db.members.filter((x) => x._id !== m._id);
  return { success: true, message: 'Member deleted' };
});

/* ---- issues ---- */
const findIssue = (user, ref) => {
  const i = isHex24(ref) ? find('issues', ref) : db.issues.find((x) => x.transactionId === String(ref).toUpperCase());
  if (!i || (user.role === 'student' && i.member !== user.member)) fail(404, 'Transaction not found');
  return i;
};
on('GET', '/issues', ({ user, query }) => {
  let list = scope(user, db.issues);
  if (query.status) list = list.filter((i) => (query.status === 'Active' ? ACTIVE.includes(i.status) : i.status === query.status));
  if (query.search) {
    const rx = new RegExp(escRx(query.search), 'i');
    list = list.filter((i) => [i.transactionId, i.memberCode, i.memberName, i.bookCode, i.bookTitle].some((v) => rx.test(v || '')));
  }
  if (query.member) {
    const m = findMember(query.member);
    list = list.filter((i) => i.member === m._id);
  }
  if (query.from) list = list.filter((i) => new Date(i.issueDate) >= new Date(query.from));
  if (query.to) list = list.filter((i) => new Date(i.issueDate) <= addDays(query.to, 1));
  list = list.slice().sort(byDesc((i) => i.issueDate));
  const res = pageOf(list, query, 15, 500);
  const data = res.data.map((i) => {
    const o = { ...clone(i), book: sel(find('books', i.book), ['bookId', 'title', 'coverImage', 'isbn', 'price']) };
    if (ACTIVE.includes(i.status)) {
      o.daysOverdue = daysBetween(i.dueDate, new Date());
      o.estimatedFine = o.daysOverdue * db.settings.finePerDay;
    }
    return o;
  });
  return { success: true, data, pagination: res.pagination };
});
on('GET', '/issues/:id', ({ user, params }) => {
  const i = findIssue(user, params.id);
  return {
    success: true,
    data: { ...clone(i), book: clone(find('books', i.book)), member: clone(find('members', i.member)) },
    return: clone(db.returns.find((r) => r.issue === i._id)) || null,
    fines: db.fines.filter((f) => f.issue === i._id).map(fineOut),
  };
});
function createIssue(user, body) {
  needStaff(user);
  required(body, { member: 'Member', book: 'Book' });
  const s = db.settings;
  const m = findMember(body.member);
  const b = findBook(body.book);
  syncMember(m._id);
  if (m.status !== 'Active') fail(400, `Membership is ${m.status}. Book cannot be issued.`);
  if (new Date(m.membershipExpiry) < new Date()) fail(400, 'Membership has expired. Renew it first.');
  if (m.booksIssued >= s.maxBooksPerMember) fail(400, `Member already has ${m.booksIssued} books (limit ${s.maxBooksPerMember}).`);
  if (m.pendingFine > s.maxPendingFine) fail(400, `Member has ₹${m.pendingFine} pending fines (limit ₹${s.maxPendingFine}). Collect payment first.`);
  if (db.issues.some((i) => i.member === m._id && i.book === b._id && ACTIVE.includes(i.status))) fail(400, 'This member already has a copy of this book.');
  const held = db.reservations.find((r) => r.member === m._id && r.book === b._id && r.status === 'Available');
  recalcBook(b._id);
  if (!held && b.availableCopies < 1) fail(400, `No copies of "${b.title}" are available. You can reserve it instead.`);
  const due = body.dueDate ? new Date(body.dueDate) : addDays(new Date(), Number(body.days) || s.loanDays);
  if (Number.isNaN(due.getTime()) || startOfDay(due) <= startOfDay(new Date())) fail(400, 'Due date must be in the future', { dueDate: 'Due date must be in the future' });
  due.setHours(23, 59, 0, 0);
  const issue = create('issues', { transactionId: nextId('issue', 'TXN', 5), member: m._id, book: b._id, memberCode: m.memberId, memberName: m.name, bookCode: b.bookId, bookTitle: b.title, issueDate: now(), dueDate: due.toISOString(), renewalCount: 0, staff: user._id, staffName: user.name, status: 'Issued', fineAmount: 0, dueSoonNotified: false, overdueNotified: false });
  if (held) held.status = 'Collected';
  else {
    db.reservations.filter((r) => r.member === m._id && r.book === b._id && r.status === 'Waiting').forEach((r) => (r.status = 'Collected'));
    refreshQueuePositions(b._id);
  }
  b.timesBorrowed += 1;
  const book = recalcBook(b._id);
  syncMember(m._id);
  notify({ audience: 'member', member: m._id, type: 'issued', title: 'Book issued', message: `"${b.title}" has been issued to you. Due date: ${due.toDateString()}.`, link: `book-details.html?id=${b.bookId}` });
  return { success: true, data: clone(issue), book: clone(book) };
}
on('POST', '/issues', ({ user, body }) => createIssue(user, body));
on('PATCH', '/issues/:id/renew', ({ user, params }) => {
  const s = db.settings;
  const i = findIssue(user, params.id);
  if (!ACTIVE.includes(i.status)) fail(400, `Cannot renew a ${i.status.toLowerCase()} transaction`);
  if (i.status === 'Overdue' || startOfDay(i.dueDate) < startOfDay(new Date())) fail(400, 'Overdue books cannot be renewed. Please return the book and clear the fine.');
  if (i.renewalCount >= s.maxRenewals) fail(400, `Renewal limit reached (${s.maxRenewals})`);
  const waiting = db.reservations.filter((r) => r.book === i.book && r.status === 'Waiting').length;
  if (waiting) fail(400, `Cannot renew — ${waiting} member(s) are waiting for this book`);
  Object.assign(stamp(i), { dueDate: addDays(i.dueDate, s.loanDays).toISOString(), renewalCount: i.renewalCount + 1, dueSoonNotified: false });
  notify({ audience: 'member', member: i.member, type: 'issued', title: 'Book renewed', message: `"${i.bookTitle}" renewed. New due date: ${new Date(i.dueDate).toDateString()}.`, link: 'issues.html' });
  return { success: true, data: clone(i), message: `Renewed until ${new Date(i.dueDate).toDateString()}` };
});

/* ---- returns ---- */
function charges(i, book, { condition = 'Good', returnDate = new Date(), damageCharge } = {}) {
  const s = db.settings;
  const daysOverdue = daysBetween(i.dueDate, returnDate);
  const lateFine = daysOverdue * s.finePerDay;
  const price = book?.price || 0;
  const dmg = condition === 'Damaged' ? (damageCharge !== undefined && damageCharge !== '' ? Number(damageCharge) : round2((price * s.damageChargePercent) / 100)) : 0;
  const lost = condition === 'Lost' ? price + s.lostProcessingFee : 0;
  return { daysOverdue, lateFine, damageCharge: dmg, lostCharge: lost, totalFine: round2(lateFine + dmg + lost), finePerDay: s.finePerDay };
}
on('GET', '/returns/lookup', ({ user, query }) => {
  needStaff(user);
  const term = String(query.q || '').trim();
  let list = [];
  if (term) {
    const exact = (v) => String(v || '').toLowerCase() === term.toLowerCase();
    const partial = new RegExp(escRx(term), 'i');
    const isbnBooks = new Set(db.books.filter((b) => b.isbn === term).map((b) => b._id));
    list = db.issues
      .filter((i) => ACTIVE.includes(i.status) && (exact(i.transactionId) || exact(i.memberCode) || exact(i.bookCode) || isbnBooks.has(i.book) || partial.test(i.memberName) || partial.test(i.bookTitle)))
      .sort(byAsc((i) => i.dueDate))
      .slice(0, 25);
  }
  const data = list.map((i) => {
    const book = find('books', i.book);
    return { ...clone(i), book: sel(book, ['bookId', 'title', 'isbn', 'price', 'coverImage', 'authorName']), member: sel(find('members', i.member), ['memberId', 'name', 'email', 'pendingFine']), charges: charges(i, book) };
  });
  const s = db.settings;
  return { success: true, data, settings: { finePerDay: s.finePerDay, damageChargePercent: s.damageChargePercent, lostProcessingFee: s.lostProcessingFee } };
});
on('GET', '/returns', ({ user, query }) => {
  let list = scope(user, db.returns);
  if (query.condition) list = list.filter((r) => r.condition === query.condition);
  list = list.slice().sort(byDesc((r) => r.returnDate));
  const res = pageOf(list, query, 15, 500);
  return { success: true, data: res.data.map((r) => ({ ...clone(r), book: sel(find('books', r.book), ['bookId', 'title']), member: sel(find('members', r.member), ['memberId', 'name']) })), pagination: res.pagination };
});
on('POST', '/returns', ({ user, body }) => {
  needStaff(user);
  required(body, { issue: 'Transaction' });
  const s = db.settings;
  const i = findIssue(user, body.issue);
  if (!ACTIVE.includes(i.status)) fail(400, `This transaction is already ${i.status.toLowerCase()}`);
  const condition = ['Good', 'Damaged', 'Lost'].includes(body.condition) ? body.condition : 'Good';
  const returnDate = body.returnDate ? new Date(body.returnDate) : new Date();
  if (Number.isNaN(returnDate.getTime()) || returnDate < startOfDay(i.issueDate)) fail(400, 'Return date cannot be before the issue date');
  if (returnDate > new Date(Date.now() + 60000)) fail(400, 'Return date cannot be in the future');
  if (body.damageCharge !== undefined && body.damageCharge !== '' && !(Number(body.damageCharge) >= 0)) fail(400, 'Damage charge must be a positive number');
  const book = find('books', i.book);
  const c = charges(i, book, { condition, returnDate, damageCharge: body.damageCharge });
  Object.assign(stamp(i), { returnDate: returnDate.toISOString(), status: condition === 'Good' ? 'Returned' : condition, fineAmount: c.totalFine });
  if (condition === 'Lost') book.lostCopies += 1;
  if (condition === 'Damaged') book.damagedCopies += 1;
  const ret = create('returns', { returnId: nextId('return', 'RET', 5), issue: i._id, member: i.member, book: book._id, transactionId: i.transactionId, issueDate: i.issueDate, dueDate: i.dueDate, returnDate: returnDate.toISOString(), daysOverdue: c.daysOverdue, condition, lateFine: c.lateFine, damageCharge: c.damageCharge, lostCharge: c.lostCharge, totalFine: c.totalFine, remarks: body.remarks || '', processedBy: user._id });
  const base = { member: i.member, issue: i._id, book: book._id, transactionId: i.transactionId, discount: 0, paidAmount: 0, waivedAmount: 0, status: 'Pending', daysOverdue: 0, ratePerDay: 0 };
  const fines = [];
  if (c.lateFine > 0) fines.push(create('fines', { ...base, fineId: nextId('fine', 'FIN', 5), type: 'Late Fine', daysOverdue: c.daysOverdue, ratePerDay: s.finePerDay, originalAmount: c.lateFine, description: `${c.daysOverdue} day(s) late × ₹${s.finePerDay}/day` }));
  if (c.damageCharge > 0) fines.push(create('fines', { ...base, fineId: nextId('fine', 'FIN', 5), type: 'Damage', originalAmount: c.damageCharge, description: `Damage charge for "${book.title}"` }));
  if (c.lostCharge > 0) fines.push(create('fines', { ...base, fineId: nextId('fine', 'FIN', 5), type: 'Lost Book', originalAmount: c.lostCharge, description: `Replacement ₹${book.price} + processing ₹${s.lostProcessingFee}` }));
  if (fines.length) notify({ audience: 'member', member: i.member, type: 'fine', title: 'Fine generated', message: `A fine of ₹${c.totalFine} was generated for "${book.title}" (${i.transactionId}).`, link: 'fines.html' });
  notify({ type: 'returned', title: condition === 'Good' ? 'Book returned' : `Book reported ${condition.toLowerCase()}`, message: `${i.memberName} returned "${book.title}"${c.daysOverdue ? ` ${c.daysOverdue} day(s) late` : ''}${c.totalFine ? ` — fine ₹${c.totalFine}` : ''}.`, link: 'returns.html' });
  const updated = processReservationQueue(book._id);
  recalcShelf(book.location?.shelf);
  syncMember(i.member);
  return { success: true, data: clone(ret), fines: fines.map(fineOut), book: clone(updated), message: c.totalFine ? `Returned with fine ₹${c.totalFine}` : 'Returned on time — no fine' };
});

/* ---- reservations ---- */
const findRes = (user, ref) => {
  const r = isHex24(ref) ? find('reservations', ref) : db.reservations.find((x) => x.reservationId === String(ref).toUpperCase());
  if (!r || (user.role === 'student' && r.member !== user.member)) fail(404, 'Reservation not found');
  return r;
};
on('GET', '/reservations', ({ user, query }) => {
  let list = scope(user, db.reservations);
  if (query.status) list = list.filter((r) => r.status === query.status);
  if (query.book) {
    const b = findBook(query.book);
    list = list.filter((r) => r.book === b._id);
  }
  const order = ['Available', 'Cancelled', 'Collected', 'Expired', 'Waiting'];
  list = list.slice().sort((a, b) => order.indexOf(a.status) - order.indexOf(b.status) || b.reservationDate.localeCompare(a.reservationDate));
  const res = pageOf(list, query, 15, 500);
  return { success: true, data: res.data.map((r) => ({ ...clone(r), book: sel(find('books', r.book), ['bookId', 'title', 'coverImage', 'availableCopies', 'isbn', 'location', 'authorName']), member: sel(find('members', r.member), ['memberId', 'name', 'email']) })), pagination: res.pagination };
});
on('POST', '/reservations', ({ user, body }) => {
  required(body, { book: 'Book' });
  const s = db.settings;
  const ref = user.role === 'student' ? user.member : body.member;
  if (!ref) fail(400, user.role === 'student' ? 'Your account is not linked to a library membership' : 'Member is required');
  const m = findMember(ref);
  const b = findBook(body.book);
  if (m.status !== 'Active') fail(400, `Membership is ${m.status}. Cannot reserve.`);
  if (db.reservations.some((r) => r.member === m._id && r.book === b._id && ['Waiting', 'Available'].includes(r.status))) fail(400, 'This member already has an active reservation for this book');
  if (db.issues.some((i) => i.member === m._id && i.book === b._id && ACTIVE.includes(i.status))) fail(400, 'This member currently has this book issued');
  const r = create('reservations', { reservationId: nextId('reservation', 'RES', 5), member: m._id, book: b._id, reservationDate: now(), queuePosition: 0, expiryDate: addDays(new Date(), s.reservationValidityDays).toISOString(), status: 'Waiting', createdBy: user._id });
  processReservationQueue(b._id);
  notify({ type: 'reservation', title: 'New reservation', message: `${m.name} reserved "${b.title}" (${r.status === 'Available' ? 'ready for pickup' : `queue #${r.queuePosition}`}).`, link: 'reservations.html' });
  return { success: true, data: { ...clone(r), book: sel(b, ['bookId', 'title']), member: sel(m, ['memberId', 'name']) }, message: r.status === 'Available' ? 'A copy is on hold — ready for pickup' : `Reserved — position #${r.queuePosition} in queue` };
});
on('PATCH', '/reservations/:id/cancel', ({ user, params }) => {
  const r = findRes(user, params.id);
  if (!['Waiting', 'Available'].includes(r.status)) fail(400, `Reservation is already ${r.status.toLowerCase()}`);
  r.status = 'Cancelled';
  processReservationQueue(r.book);
  return { success: true, data: clone(r), message: 'Reservation cancelled' };
});
on('PATCH', '/reservations/:id/collect', ({ user, params, body }) => {
  needStaff(user);
  const r = findRes(user, params.id);
  if (r.status !== 'Available') fail(400, 'Only reservations marked "Available" can be collected');
  return createIssue(user, { member: r.member, book: r.book, days: body?.days });
});
on('DELETE', '/reservations/:id', ({ user, params }) => {
  need(user, 'admin', 'librarian');
  const r = findRes(user, params.id);
  if (['Waiting', 'Available'].includes(r.status)) fail(400, 'Cancel the reservation before deleting it');
  db.reservations = db.reservations.filter((x) => x._id !== r._id);
  return { success: true, message: 'Reservation deleted' };
});

/* ---- fines ---- */
const findFine = (user, ref) => {
  const f = isHex24(ref) ? find('fines', ref) : db.fines.find((x) => x.fineId === String(ref).toUpperCase());
  if (!f || (user.role === 'student' && f.member !== user.member)) fail(404, 'Fine not found');
  return f;
};
on('GET', '/fines', ({ user, query }) => {
  let list = scope(user, db.fines);
  if (query.status) list = list.filter((f) => (query.status === 'Outstanding' ? ['Pending', 'Partially Paid'].includes(f.status) : f.status === query.status));
  if (query.type) list = list.filter((f) => f.type === query.type);
  if (query.member) {
    const m = findMember(query.member);
    list = list.filter((f) => f.member === m._id);
  }
  if (query.search) {
    const rx = new RegExp(escRx(query.search), 'i');
    list = list.filter((f) => {
      const m = find('members', f.member);
      return [f.fineId, f.transactionId, f.description, m?.name, m?.memberId].some((v) => rx.test(v || ''));
    });
  }
  list = list.slice().sort(byDesc((f) => f.createdAt));
  const res = pageOf(list, query, 15, 500);
  return { success: true, data: res.data.map((f) => ({ ...fineOut(f), member: sel(find('members', f.member), ['memberId', 'name', 'email']), book: sel(find('books', f.book), ['bookId', 'title', 'price']) })), pagination: res.pagination };
});
on('GET', '/fines/summary', ({ user }) => {
  const list = scope(user, db.fines);
  const sum = (k) => list.reduce((t, f) => t + f[k], 0);
  const s = { original: sum('originalAmount'), discount: sum('discount'), paid: sum('paidAmount'), waived: sum('waivedAmount'), count: list.length, pendingCount: list.filter((f) => ['Pending', 'Partially Paid'].includes(f.status)).length };
  const byType = Object.values(list.reduce((acc, f) => ((acc[f.type] = acc[f.type] || { _id: f.type, amount: 0, count: 0 }), (acc[f.type].amount += f.originalAmount), (acc[f.type].count += 1), acc), {})).sort(byDesc((x) => x.amount));
  return { success: true, data: { ...s, remaining: round2(s.original - s.discount - s.paid - s.waived), byType, finePerDay: db.settings.finePerDay } };
});
on('POST', '/fines', ({ user, body }) => {
  needStaff(user);
  required(body, { member: 'Member', type: 'Type', amount: 'Amount' });
  if (!(Number(body.amount) >= 1)) fail(400, 'Amount must be at least 1', { amount: 'Amount must be at least 1' });
  const m = findMember(body.member);
  const f = create('fines', { fineId: nextId('fine', 'FIN', 5), member: m._id, type: body.type, originalAmount: Number(body.amount), description: body.description || '', transactionId: body.transactionId || undefined, discount: 0, paidAmount: 0, waivedAmount: 0, status: 'Pending', daysOverdue: 0, ratePerDay: 0 });
  syncMember(m._id);
  notify({ audience: 'member', member: m._id, type: 'fine', title: 'New charge added', message: `${f.type}: ₹${f.originalAmount}. ${f.description}`, link: 'fines.html' });
  return { success: true, data: fineOut(f) };
});
on('PATCH', '/fines/:id/discount', ({ user, params, body }) => {
  need(user, 'admin', 'librarian');
  const f = findFine(user, params.id);
  const d = Number(body.discount);
  if (Number.isNaN(d) || d < 0) fail(400, 'Discount must be a positive number', { discount: 'Must be a positive number' });
  if (d > f.originalAmount - f.paidAmount - f.waivedAmount) fail(400, 'Discount cannot exceed the unpaid amount', { discount: 'Cannot exceed the unpaid amount' });
  f.discount = d;
  refreshFineStatus(stamp(f));
  syncMember(f.member);
  return { success: true, data: fineOut(f), message: `Discount of ₹${d} applied` };
});
on('PATCH', '/fines/:id/waive', ({ user, params, body }) => {
  need(user, 'admin', 'librarian');
  const f = findFine(user, params.id);
  const remaining = fineRemaining(f);
  if (remaining <= 0) fail(400, 'Nothing left to waive on this fine');
  f.waivedAmount += remaining;
  refreshFineStatus(stamp(f));
  const p = create('payments', { paymentId: nextId('payment', 'PAY', 5), member: f.member, fine: f._id, transactionId: f.transactionId, reason: `${f.type} waived${body.reason ? ` — ${body.reason}` : ''}`, amount: remaining, date: now(), method: 'Cash', status: 'Waived', reference: '', notes: body.reason || '', collectedBy: user._id, collectedByName: user.name });
  syncMember(f.member);
  return { success: true, data: fineOut(f), payment: clone(p), message: `₹${remaining} waived` };
});

/* ---- payments ---- */
const findPayment = (user, ref) => {
  const r = String(ref).toUpperCase();
  const p = isHex24(ref) ? find('payments', ref) : db.payments.find((x) => x.paymentId === r || x.receiptNo === r);
  if (!p || (user.role === 'student' && p.member !== user.member)) fail(404, 'Payment not found');
  return p;
};
on('GET', '/payments', ({ user, query }) => {
  let list = scope(user, db.payments);
  if (query.status) list = list.filter((p) => p.status === query.status);
  if (query.method) list = list.filter((p) => p.method === query.method);
  if (query.member) {
    const m = findMember(query.member);
    list = list.filter((p) => p.member === m._id);
  }
  if (query.from) list = list.filter((p) => new Date(p.date) >= new Date(query.from));
  if (query.to) list = list.filter((p) => new Date(p.date) <= addDays(query.to, 1));
  if (query.search) {
    const rx = new RegExp(escRx(query.search), 'i');
    list = list.filter((p) => {
      const m = find('members', p.member);
      return [p.paymentId, p.receiptNo, p.transactionId, p.reason, p.reference, m?.name, m?.memberId].some((v) => rx.test(v || ''));
    });
  }
  const totals = Object.values(list.reduce((acc, p) => ((acc[p.status] = acc[p.status] || { _id: p.status, amount: 0, count: 0 }), (acc[p.status].amount += p.amount), (acc[p.status].count += 1), acc), {}));
  list = list.slice().sort(byDesc((p) => p.date));
  const res = pageOf(list, query, 15, 500);
  return { success: true, data: res.data.map((p) => ({ ...clone(p), member: sel(find('members', p.member), ['memberId', 'name', 'email']), fine: sel(find('fines', p.fine), ['fineId', 'type']) })), totals, pagination: res.pagination };
});
on('GET', '/payments/:id', ({ user, params }) => {
  const p = findPayment(user, params.id);
  const f = find('fines', p.fine);
  return { success: true, data: { ...clone(p), member: clone(find('members', p.member)), fine: f ? { ...fineOut(f), book: sel(find('books', f.book), ['bookId', 'title']) } : null }, library: { name: db.settings.libraryName } };
});
const reference = (method) => {
  const r = oid().slice(0, 8).toUpperCase();
  return { UPI: `UPI${Date.now().toString().slice(-8)}${r.slice(0, 4)}`, Card: `AUTH-${r}`, 'Bank Transfer': `NEFT${Date.now().toString().slice(-10)}` }[method] || `CASH-${r.slice(0, 6)}`;
};
on('POST', '/payments', ({ user, body }) => {
  needStaff(user);
  const amount = round2(body.amount);
  if (!(amount > 0)) fail(400, 'Amount must be greater than zero', { amount: 'Amount must be greater than zero' });
  const method = body.method || 'Cash';
  if (!['Cash', 'UPI', 'Card', 'Bank Transfer'].includes(method)) fail(400, 'Invalid payment method');
  let fine = null;
  let m;
  if (body.fine) {
    fine = isHex24(body.fine) ? find('fines', body.fine) : db.fines.find((f) => f.fineId === String(body.fine).toUpperCase());
    if (!fine) fail(404, 'Fine not found');
    if (fineRemaining(fine) <= 0) fail(400, 'This fine is already settled');
    if (amount > fineRemaining(fine)) fail(400, `Amount exceeds the remaining balance of ₹${fineRemaining(fine)}`, { amount: `Cannot exceed ₹${fineRemaining(fine)}` });
    m = find('members', fine.member);
  } else {
    m = findMember(body.member);
    if (!body.reason) fail(400, 'Reason is required for payments not linked to a fine');
  }
  const pending = body.status === 'Pending';
  const status = pending ? 'Pending' : fine && amount < fineRemaining(fine) ? 'Partially Paid' : 'Paid';
  const p = create('payments', { paymentId: nextId('payment', 'PAY', 5), receiptNo: pending ? undefined : nextId('receipt', 'RCPT-', 6), member: m._id, fine: fine?._id, transactionId: fine?.transactionId || body.transactionId || undefined, reason: body.reason || (fine ? `${fine.type}${fine.description ? ` — ${fine.description}` : ''}` : ''), amount, date: now(), method, status, reference: reference(method), notes: body.notes || '', collectedBy: user._id, collectedByName: user.name });
  if (fine && !pending) {
    fine.paidAmount = round2(fine.paidAmount + amount);
    refreshFineStatus(stamp(fine));
  }
  syncMember(m._id);
  if (!pending) {
    notify({ audience: 'member', member: m._id, type: 'payment', title: 'Payment received', message: `₹${amount} received via ${method} (${p.receiptNo}). Thank you!`, link: 'payments.html' });
    notify({ type: 'payment', title: 'Payment completed', message: `${m.name} paid ₹${amount} via ${method} — ${p.reason}.`, link: 'payments.html' });
  }
  return { success: true, data: clone(p), fine: fine ? fineOut(fine) : null, message: pending ? 'Payment recorded as pending' : `Payment of ₹${amount} successful` };
});
on('PATCH', '/payments/:id/confirm', ({ user, params }) => {
  needStaff(user);
  const p = findPayment(user, params.id);
  if (p.status !== 'Pending') fail(400, 'Only pending payments can be confirmed');
  const f = p.fine && find('fines', p.fine);
  if (f) {
    if (p.amount > fineRemaining(f)) fail(400, `Fine balance is now ₹${fineRemaining(f)}; payment exceeds it`);
    f.paidAmount = round2(f.paidAmount + p.amount);
    refreshFineStatus(stamp(f));
    p.status = f.status === 'Paid' ? 'Paid' : 'Partially Paid';
  } else p.status = 'Paid';
  Object.assign(stamp(p), { receiptNo: nextId('receipt', 'RCPT-', 6), date: now() });
  syncMember(p.member);
  notify({ audience: 'member', member: p.member, type: 'payment', title: 'Payment confirmed', message: `₹${p.amount} confirmed (${p.receiptNo}).`, link: 'payments.html' });
  return { success: true, data: clone(p), message: 'Payment confirmed' };
});

/* ---- notifications ---- */
const visible = (user) => db.notifications.filter((n) => n.audience === 'all' || (n.audience === 'staff' && isStaff(user)) || (n.audience === 'member' && user.member && n.member === user.member));
const unreadOf = (user) => visible(user).filter((n) => !(n.readBy || []).includes(user._id)).length;
on('GET', '/notifications', ({ user, query }) => {
  let list = visible(user);
  if (query.type) list = list.filter((n) => n.type === query.type);
  if (query.unread === 'true') list = list.filter((n) => !(n.readBy || []).includes(user._id));
  list = list.slice().sort(byDesc((n) => n.createdAt));
  const res = pageOf(list, query, 20, 100);
  return { success: true, data: res.data.map(({ readBy, ...n }) => ({ ...clone(n), read: (readBy || []).includes(user._id) })), unread: unreadOf(user), pagination: res.pagination };
});
on('GET', '/notifications/unread-count', ({ user }) => ({ success: true, unread: unreadOf(user) }));
on('PATCH', '/notifications/read-all', ({ user }) => {
  let updated = 0;
  visible(user).forEach((n) => {
    n.readBy = n.readBy || [];
    if (!n.readBy.includes(user._id)) {
      n.readBy.push(user._id);
      updated += 1;
    }
  });
  return { success: true, updated };
});
on('PATCH', '/notifications/:id/read', ({ user, params }) => {
  const n = visible(user).find((x) => x._id === params.id) || fail(404, 'Notification not found');
  n.readBy = [...new Set([...(n.readBy || []), user._id])];
  return { success: true };
});
on('POST', '/notifications', ({ user, body }) => {
  needStaff(user);
  required(body, { title: 'Title', message: 'Message' });
  return { success: true, data: clone(notify({ ...pick(body, ['audience', 'member', 'title', 'message', 'link']), type: 'system' })) };
});
on('DELETE', '/notifications/:id', ({ user, params }) => {
  needStaff(user);
  db.notifications = db.notifications.filter((n) => n._id !== params.id);
  return { success: true, message: 'Notification deleted' };
});

/* ---- settings ---- */
const SETTING_FIELDS = ['libraryName', 'finePerDay', 'loanDays', 'maxRenewals', 'maxBooksPerMember', 'maxPendingFine', 'reservationHoldDays', 'reservationValidityDays', 'lostProcessingFee', 'damageChargePercent', 'membershipFee', 'dueSoonDays'];
on('GET', '/settings', () => ({ success: true, data: clone(db.settings) }));
on('PUT', '/settings', ({ user, body }) => {
  need(user, 'admin');
  const d = pick(body, SETTING_FIELDS);
  Object.entries(d).forEach(([k, v]) => {
    if (k !== 'libraryName') {
      d[k] = Number(v);
      if (Number.isNaN(d[k]) || d[k] < 0) fail(400, `${k} must be a positive number`, { [k]: 'Must be a positive number' });
    }
  });
  Object.assign(stamp(db.settings), d);
  return { success: true, data: clone(db.settings), message: 'Settings saved' };
});

/* ---- reports ---- */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function lastMonths(n) {
  const d = new Date();
  return Array.from({ length: n }, (_, i) => {
    const m = new Date(d.getFullYear(), d.getMonth() - (n - 1 - i), 1);
    return { y: m.getFullYear(), m: m.getMonth(), label: `${MONTHS[m.getMonth()]} '${String(m.getFullYear()).slice(2)}` };
  });
}
const monthly = (list, dateKey, valFn, months) =>
  months.map(({ y, m }) => round2(list.filter((x) => x[dateKey] && new Date(x[dateKey]).getFullYear() === y && new Date(x[dateKey]).getMonth() === m).reduce((t, x) => t + valFn(x), 0)));

on('GET', '/reports/dashboard', () => {
  runMaintenance();
  recalcAllShelves();
  const s = db.settings;
  const nowD = new Date();
  const months = lastMonths(6);
  const sum = (k) => db.books.reduce((t, b) => t + (b[k] || 0), 0);
  const fineTotal = db.fines.reduce((t, f) => t + f.originalAmount - f.discount, 0);
  const finePaid = db.fines.reduce((t, f) => t + f.paidAmount + f.waivedAmount, 0);
  const collected = db.payments.filter((p) => ['Paid', 'Partially Paid'].includes(p.status)).reduce((t, p) => t + p.amount, 0);
  const overdue = db.issues.filter((i) => i.status === 'Overdue').sort(byAsc((i) => i.dueDate));
  const accruing = overdue.reduce((t, i) => t + daysBetween(i.dueDate, nowD) * s.finePerDay, 0);
  const catMap = {};
  db.books.forEach((b) => {
    catMap[b.categoryName] = catMap[b.categoryName] || { label: b.categoryName, value: 0, titles: 0 };
    catMap[b.categoryName].value += b.quantity;
    catMap[b.categoryName].titles += 1;
  });
  return {
    success: true,
    data: {
      stats: {
        totalBooks: sum('quantity'),
        titles: db.books.length,
        availableBooks: sum('availableCopies'),
        issuedBooks: sum('issuedCopies'),
        reservedBooks: sum('reservedCopies'),
        waitingReservations: db.reservations.filter((r) => r.status === 'Waiting').length,
        lostBooks: sum('lostCopies'),
        damagedBooks: sum('damagedCopies'),
        totalMembers: db.members.length,
        activeMembers: db.members.filter((m) => m.status === 'Active').length,
        overdueBooks: overdue.length,
        totalFines: round2(fineTotal + accruing),
        finesOutstanding: round2(fineTotal - finePaid + accruing),
        accruingFines: accruing,
        totalCollected: round2(collected),
        booksAddedRecently: db.books.filter((b) => new Date(b.createdAt) >= addDays(nowD, -30)).length,
        collectionValue: round2(db.books.reduce((t, b) => t + b.currentValue * b.quantity, 0)),
      },
      charts: {
        months: months.map((m) => m.label),
        issued: monthly(db.issues, 'issueDate', () => 1, months),
        returned: monthly(db.returns, 'returnDate', () => 1, months),
        fines: monthly(db.fines, 'createdAt', (f) => f.originalAmount, months),
        collected: monthly(db.payments.filter((p) => ['Paid', 'Partially Paid'].includes(p.status)), 'date', (p) => p.amount, months),
        popular: db.books.filter((b) => b.timesBorrowed > 0).sort(byDesc((b) => b.timesBorrowed)).slice(0, 7).map((b) => ({ label: b.title, author: b.authorName, value: b.timesBorrowed, id: b.bookId })),
        categories: Object.values(catMap).sort(byDesc((c) => c.value)),
        shelves: db.shelves
          .slice()
          .sort((a, b) => a.floor - b.floor || a.code.localeCompare(b.code))
          .map((x) => ({ label: x.name, code: x.code, floor: x.floor, section: x.section, occupied: x.occupied, capacity: x.capacity, percent: x.capacity ? Math.round((x.occupied / x.capacity) * 100) : 0 })),
      },
      recentTransactions: clone(db.issues.slice().sort(byDesc((i) => i.updatedAt)).slice(0, 8)),
      recentMembers: clone(db.members.slice().sort(byDesc((m) => m.createdAt)).slice(0, 5)),
      recentBooks: clone(db.books.slice().sort(byDesc((b) => b.createdAt)).slice(0, 5)),
      overdue: overdue.slice(0, 6).map((i) => ({ ...clone(i), book: sel(find('books', i.book), ['bookId', 'title', 'coverImage']), daysOverdue: daysBetween(i.dueDate, nowD), fine: daysBetween(i.dueDate, nowD) * s.finePerDay })),
    },
  };
});
const fmtD = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
const inRange = (d, q) => (!q.from || new Date(d) >= new Date(q.from)) && (!q.to || new Date(d) <= addDays(q.to, 1));
const REPORTS = {
  books: ['Books Report', ['Book ID', 'Title', 'Author', 'Category', 'ISBN', 'Total', 'Available', 'Issued', 'Price (₹)', 'Location', 'Status'], () => db.books.slice().sort(byAsc((b) => b.bookId)).map((b) => [b.bookId, b.title, b.authorName, b.categoryName, b.isbn, b.quantity, b.availableCopies, b.issuedCopies, b.price, `F${b.location?.floor}-${b.location?.shelfCode}-R${b.location?.rack}-${b.location?.row}${b.location?.position}`, b.status])],
  issued: ['Issued Books Report', ['Transaction', 'Member ID', 'Member', 'Book ID', 'Book', 'Issue Date', 'Due Date', 'Renewals', 'Staff', 'Status'], (q) => db.issues.filter((i) => ACTIVE.includes(i.status) && inRange(i.issueDate, q)).sort(byDesc((i) => i.issueDate)).map((i) => [i.transactionId, i.memberCode, i.memberName, i.bookCode, i.bookTitle, fmtD(i.issueDate), fmtD(i.dueDate), i.renewalCount, i.staffName, i.status])],
  returned: ['Returned Books Report', ['Return ID', 'Transaction', 'Member', 'Book', 'Issue Date', 'Due Date', 'Return Date', 'Days Late', 'Condition', 'Fine (₹)'], (q) => db.returns.filter((r) => inRange(r.returnDate, q)).sort(byDesc((r) => r.returnDate)).map((r) => [r.returnId, r.transactionId, find('members', r.member)?.name, find('books', r.book)?.title, fmtD(r.issueDate), fmtD(r.dueDate), fmtD(r.returnDate), r.daysOverdue, r.condition, r.totalFine])],
  overdue: ['Overdue Report', ['Transaction', 'Member ID', 'Member', 'Book', 'Due Date', 'Days Overdue', 'Fine So Far (₹)'], () => db.issues.filter((i) => i.status === 'Overdue').sort(byAsc((i) => i.dueDate)).map((i) => {
    const d = daysBetween(i.dueDate, new Date());
    return [i.transactionId, i.memberCode, i.memberName, i.bookTitle, fmtD(i.dueDate), d, d * db.settings.finePerDay];
  })],
  fines: ['Fine Report', ['Fine ID', 'Member', 'Type', 'Transaction', 'Original (₹)', 'Discount (₹)', 'Paid (₹)', 'Waived (₹)', 'Remaining (₹)', 'Status', 'Date'], (q) => db.fines.filter((f) => inRange(f.createdAt, q)).sort(byDesc((f) => f.createdAt)).map((f) => {
    const m = find('members', f.member);
    return [f.fineId, `${m?.name} (${m?.memberId})`, f.type, f.transactionId || '', f.originalAmount, f.discount, f.paidAmount, f.waivedAmount, fineRemaining(f), f.status, fmtD(f.createdAt)];
  })],
  payments: ['Payment Report', ['Payment ID', 'Receipt', 'Member', 'Reason', 'Amount (₹)', 'Method', 'Status', 'Date', 'Collected By'], (q) => db.payments.filter((p) => inRange(p.date, q)).sort(byDesc((p) => p.date)).map((p) => {
    const m = find('members', p.member);
    return [p.paymentId, p.receiptNo || '—', `${m?.name} (${m?.memberId})`, p.reason, p.amount, p.method, p.status, fmtD(p.date), p.collectedByName || ''];
  })],
  members: ['Member Report', ['Member ID', 'Name', 'Email', 'Phone', 'Department', 'Type', 'Expiry', 'Issued', 'Returned', 'Pending Fine (₹)', 'Paid (₹)', 'Status'], () => db.members.slice().sort(byAsc((m) => m.memberId)).map((m) => [m.memberId, m.name, m.email, m.phone, m.department, m.membershipType, fmtD(m.membershipExpiry), m.booksIssued, m.booksReturned, m.pendingFine, m.totalFinePaid, m.status])],
  popular: ['Popular Books Report', ['Rank', 'Book ID', 'Title', 'Author', 'Category', 'Times Borrowed', 'Available / Total'], () => db.books.slice().sort((a, b) => b.timesBorrowed - a.timesBorrowed || a.title.localeCompare(b.title)).slice(0, 25).map((b, i) => [i + 1, b.bookId, b.title, b.authorName, b.categoryName, b.timesBorrowed, `${b.availableCopies} / ${b.quantity}`])],
  shelves: ['Shelf Occupancy Report', ['Shelf ID', 'Name', 'Floor', 'Section', 'Racks', 'Capacity', 'Occupied', 'Available', 'Occupancy %', 'Status'], () => {
    recalcAllShelves();
    return db.shelves.slice().sort((a, b) => a.floor - b.floor || a.code.localeCompare(b.code)).map((x) => {
      const o = shelfOut(x);
      return [x.shelfId, x.name, x.floor, x.section, x.racks, x.capacity, x.occupied, o.availableSpace, `${o.occupancyPercent}%`, x.status];
    });
  }],
};
on('GET', '/reports', ({ user }) => {
  needStaff(user);
  return { success: true, data: Object.entries(REPORTS).map(([key, [title]]) => ({ key, title })) };
});
on('GET', '/reports/:type', ({ user, params, query }) => {
  needStaff(user);
  const r = REPORTS[params.type] || fail(404, 'Unknown report type');
  return { success: true, data: { key: params.type, title: r[0], columns: r[1], rows: r[2](query), generatedAt: now() } };
});

/* ---- AI assistant (same rules as backend/controllers/aiController.js) ---- */
const inr = (n) => `₹${Number(n).toLocaleString('en-IN')}`;
const sectionLabel = (x = '') => (/section$/i.test(x) ? x : `${x} Section`);
const locationText = (l = {}) => `Floor ${l.floor}, ${sectionLabel(l.section)}, Shelf ${l.shelfCode}, Rack ${l.rack}, Row ${l.row}, Position ${l.position}`;
const CATEGORY_ALIASES = {
  programming: ['programming', 'coding', 'code', 'software', 'developer'],
  science: ['science', 'scientific', 'physics', 'biology', 'astronomy'],
  technology: ['technology', 'tech'],
  engineering: ['engineering', 'engineer'],
  mathematics: ['mathematics', 'math', 'maths'],
  history: ['history', 'historical'],
  biography: ['biography', 'biographies', 'autobiography', 'memoir'],
  business: ['business', 'finance', 'management'],
  entrepreneurship: ['entrepreneurship', 'startup', 'startups', 'entrepreneur'],
  'competitive exams': ['competitive', 'exam', 'exams', 'upsc', 'gate', 'aptitude'],
  reference: ['reference', 'dictionary', 'encyclopedia'],
  fiction: ['fiction', 'novel', 'novels', 'story', 'stories'],
};
const STOP = new Set('show me list find get give all any the a an of books book with for please some that are is available which what do you have search looking look i want need on in at by'.split(' '));
const aiBook = (b) => ({ ...clone(b), locationText: b.location ? locationText(b.location) : '' });

function titleSearch(term) {
  const clean = term.replace(/[?."'!]/g, '').replace(/^(the book|book)\s+/i, '').trim();
  if (!clean) return [];
  let r = db.books.filter((b) => b.title.toLowerCase() === clean.toLowerCase());
  if (!r.length) r = db.books.filter((b) => new RegExp(escRx(clean), 'i').test(b.title)).slice(0, 5);
  if (!r.length) r = db.books.filter((b) => new RegExp(escRx(clean.replace(/^(the|a|an)\s+/i, '')), 'i').test(b.title)).slice(0, 5);
  if (!r.length) {
    const words = clean.toLowerCase().split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
    r = db.books.map((b) => [b, words.filter((w) => `${b.title} ${b.authorName} ${b.description}`.toLowerCase().includes(w)).length]).filter(([, s]) => s).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([b]) => b);
  }
  return r;
}
function parsePrice(text) {
  const n = '(?:₹|rs\\.?|inr)?\\s*(\\d+(?:,\\d{3})*(?:\\.\\d+)?)';
  const c = (x) => Number(x.replace(/,/g, ''));
  let m = text.match(new RegExp(`between\\s+${n}\\s+(?:and|to|-)\\s+${n}`, 'i'));
  if (m) return { minPrice: c(m[1]), maxPrice: c(m[2]) };
  m = text.match(new RegExp(`(?:under|below|less than|cheaper than|within|upto|up to|<)\\s*${n}`, 'i'));
  if (m) return { maxPrice: c(m[1]) };
  m = text.match(new RegExp(`(?:over|above|more than|greater than|>)\\s*${n}`, 'i'));
  if (m) return { minPrice: c(m[1]) };
  return {};
}
function parseQuery(text) {
  const lower = text.toLowerCase();
  const q = parsePrice(lower);
  const u = [];
  if (q.maxPrice !== undefined && q.minPrice !== undefined) u.push(`price ${inr(q.minPrice)}–${inr(q.maxPrice)}`);
  else if (q.maxPrice !== undefined) u.push(`price under ${inr(q.maxPrice)}`);
  else if (q.minPrice !== undefined) u.push(`price over ${inr(q.minPrice)}`);
  for (const c of db.categories) {
    const aliases = CATEGORY_ALIASES[c.name.toLowerCase()] || [c.name.toLowerCase()];
    if (aliases.some((a) => new RegExp(`\\b${escRx(a)}\\b`, 'i').test(lower)) || lower.includes(c.name.toLowerCase())) {
      q.category = c.name;
      u.push(`category ${c.name}`);
      break;
    }
  }
  const au = text.match(/\b(?:by|author|written by|from author)\s+([a-z][a-z.\s'-]+?)(?=\s+(?:under|below|over|above|on|in|at|between|priced|that|which|with|available)\b|[?.,!]|$)/i);
  if (au) {
    q.author = au[1].trim();
    u.push(`author "${q.author}"`);
  }
  const fl = lower.match(/\bfloor\s*(\d+)|\b(\d+)(?:st|nd|rd|th)\s+floor/);
  if (fl) {
    q.floor = Number(fl[1] || fl[2]);
    u.push(`floor ${q.floor}`);
  }
  const sh = text.match(/\bshelf\s+([a-z]{1,2})\b/i);
  if (sh) {
    q.shelf = sh[1].toUpperCase();
    u.push(`shelf ${q.shelf}`);
  }
  const rk = lower.match(/\brack\s*(\d+)/);
  if (rk) {
    q.rack = rk[1];
    u.push(`rack ${rk[1].padStart(2, '0')}`);
  }
  const lang = [...new Set(db.books.map((b) => b.language))].find((l) => new RegExp(`\\b${escRx(l)}\\b`, 'i').test(lower));
  if (lang) {
    q.language = lang;
    u.push(`language ${lang}`);
  }
  if (/\b(available|in stock)\b/.test(lower)) (q.status = 'available'), u.push('available now');
  else if (/\b(issued|checked out|borrowed)\b/.test(lower)) (q.status = 'issued'), u.push('currently issued');
  else if (/\breserved\b/.test(lower)) (q.status = 'reserved'), u.push('reserved');
  else if (/\blost\b/.test(lower)) (q.status = 'lost'), u.push('lost copies');
  else if (/\bdamaged\b/.test(lower)) (q.status = 'damaged'), u.push('damaged copies');
  if (!u.length) {
    const words = lower.replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w && !STOP.has(w));
    if (words.length) {
      q.search = words.join(' ');
      u.push(`keywords "${q.search}"`);
    }
  }
  return { q, understood: u };
}
on('POST', '/ai/query', ({ user, body }) => {
  const message = String(body.message || '').trim().slice(0, 300);
  const lower = message.toLowerCase();
  const reply = (p) => ({ success: true, data: { query: message, ...p } });
  const staff = isStaff(user);
  if (!message || /^(hi|hello|hey|help|what can you do|\?)\b/i.test(lower)) {
    return reply({ intent: 'help', reply: "Hi! I'm your SmartLib assistant. I can locate books on the shelf, search by price, author, category, floor or language, list overdue books, show popular titles and summarise library statistics.", suggestions: ['Where is The Alchemist?', 'Show science books under ₹500', 'Find available books by Chetan Bhagat', 'Which books are overdue?', 'Show books available on Floor 2', 'Most popular books'] });
  }
  const loc = message.match(/(?:where\s+is|where's|where\s+can\s+i\s+find|locate|location\s+of|which\s+shelf\s+(?:is|has)|find\s+the\s+book)\s+(.+)/i);
  if (loc) {
    const books = titleSearch(loc[1]);
    if (!books.length) return reply({ intent: 'location', reply: `I couldn't find a book matching "${loc[1].replace(/[?]/g, '')}". Try the exact title or search by author.`, books: [] });
    const b = books[0];
    let status;
    if (b.availableCopies > 0) status = `is available (${b.availableCopies} of ${b.quantity} copies) on`;
    else {
      const next = db.issues.filter((i) => i.book === b._id && ACTIVE.includes(i.status)).sort(byAsc((i) => i.dueDate))[0];
      status = `is currently ${b.status.toLowerCase()}${next ? ` (next expected back ${new Date(next.dueDate).toDateString()})` : ''}. Its shelf location is`;
    }
    return reply({ intent: 'location', reply: `${b.title} ${status} ${locationText(b.location)}.`, location: b.location, books: books.map(aiBook) });
  }
  if (/\boverdue\b|\blate\b.*\bbooks?\b/.test(lower)) {
    let list = db.issues.filter((i) => i.status === 'Overdue');
    if (!staff || /\bmy\b/.test(lower)) list = list.filter((i) => i.member === user.member);
    const rows = list.sort(byAsc((i) => i.dueDate)).slice(0, 20).map((i) => {
      const d = daysBetween(i.dueDate, new Date());
      return { ...clone(i), daysOverdue: d, fine: d * db.settings.finePerDay };
    });
    const total = rows.reduce((t, r) => t + r.fine, 0);
    return reply({ intent: 'overdue', reply: rows.length ? `${rows.length} book${rows.length > 1 ? 's are' : ' is'} overdue, with ${inr(total)} in fines accruing at ${inr(db.settings.finePerDay)}/day.` : 'Great news — there are no overdue books right now.', issues: rows });
  }
  if (/\bmy\s+(books|loans|issued)\b/.test(lower) && user.member) {
    const issues = db.issues.filter((i) => i.member === user.member && ACTIVE.includes(i.status)).sort(byAsc((i) => i.dueDate));
    return reply({ intent: 'my-books', reply: issues.length ? `You have ${issues.length} book(s) issued. The next one is due on ${new Date(issues[0].dueDate).toDateString()}.` : "You don't have any books issued right now.", issues: clone(issues) });
  }
  if (/\b(my\s+)?(fines?|dues|penalt)/.test(lower) && (/\bmy\b/.test(lower) || !staff)) {
    const m = user.member && find('members', user.member);
    const fines = m ? db.fines.filter((f) => f.member === m._id && ['Pending', 'Partially Paid'].includes(f.status)) : [];
    return reply({ intent: 'fines', reply: m ? (m.pendingFine > 0 ? `You have ${inr(m.pendingFine)} in pending fines across ${fines.length} charge(s).` : 'You have no pending fines. 🎉') : 'Your account is not linked to a membership.', fines: fines.map(fineOut) });
  }
  if (/\b(pending|outstanding|total)\s+fines?\b|\bfines?\s+(collected|pending|outstanding)/.test(lower) && staff) {
    const a = db.fines.reduce((t, f) => ({ total: t.total + f.originalAmount, discount: t.discount + f.discount, paid: t.paid + f.paidAmount, waived: t.waived + f.waivedAmount }), { total: 0, discount: 0, paid: 0, waived: 0 });
    return reply({ intent: 'stats', reply: `Fines generated: ${inr(a.total)}. Collected: ${inr(a.paid)}. Waived/discounted: ${inr(a.waived + a.discount)}. Outstanding: ${inr(a.total - a.paid - a.waived - a.discount)}.` });
  }
  if (/\bhow many\b|\bstatistic|\bstats\b|\bsummary\b|\btotal books\b/.test(lower) && !/\bby\b/.test(lower)) {
    const sum = (k) => db.books.reduce((t, b) => t + b[k], 0);
    return reply({ intent: 'stats', reply: `The library has ${sum('quantity')} books (${db.books.length} titles): ${sum('availableCopies')} available and ${sum('issuedCopies')} issued. ${db.members.filter((m) => m.status === 'Active').length} active members, ${db.issues.filter((i) => i.status === 'Overdue').length} overdue loans.` });
  }
  if (/\b(popular|most borrowed|trending|best|top)\b/.test(lower)) {
    const books = db.books.slice().sort(byDesc((b) => b.timesBorrowed)).slice(0, 8);
    return reply({ intent: 'books', reply: `Here are the ${books.length} most borrowed books in the library.`, books: books.map(aiBook), filters: { sort: 'popular' } });
  }
  if (/\b(new|latest|recent(ly)?)\b.*\b(books?|arrivals?|added)\b|\bnew arrivals\b/.test(lower)) {
    return reply({ intent: 'books', reply: 'These are the most recently added books.', books: db.books.slice().sort(byDesc((b) => b.createdAt)).slice(0, 8).map(aiBook), filters: { sort: 'newest' } });
  }
  if (/\brecommend|suggest/.test(lower)) {
    return reply({ intent: 'books', reply: 'Based on what readers love right now, I recommend these (all available today):', books: db.books.filter((b) => b.availableCopies > 0).sort(byDesc((b) => b.timesBorrowed)).slice(0, 6).map(aiBook) });
  }
  const { q, understood } = parseQuery(message);
  if (!understood.length) return reply({ intent: 'unknown', reply: "I'm not sure what you're looking for. Try asking where a book is, or search by author, category, price or floor.", suggestions: ['Where is Wings of Fire?', 'Programming books under ₹800', 'Books by R.K. Narayan', 'Books on Floor 3'] });
  const list = filterBooks(q).sort((a, b) => b.availableCopies - a.availableCopies || b.timesBorrowed - a.timesBorrowed);
  const books = list.slice(0, 12);
  return reply({ intent: 'books', reply: list.length ? `I found ${list.length} book${list.length > 1 ? 's' : ''} matching ${understood.join(', ')}.${list.length > books.length ? ` Showing the top ${books.length}.` : ''}` : `No books match ${understood.join(', ')}. Try widening your search.`, books: books.map(aiBook), filters: q, total: list.length });
});

on('GET', '/health', () => ({ success: true, status: 'ok', mode: 'demo' }), { open: true });

/* ============================== Dispatcher ============================== */

let maintained = false;
/** Handle one API call. Mirrors fetch semantics of the real backend: resolves with JSON or throws {status, message, details}. */
export async function demoRequest(method, path, { body, params, token } = {}) {
  if (!db) load();
  if (!maintained) {
    maintained = true;
    runMaintenance();
    save();
  }
  const route = routes.find((r) => r.method === method && r.rx.test(path));
  // Tiny delay so loading states and skeletons are visible, like a real network
  await new Promise((r) => setTimeout(r, 120 + Math.random() * 180));
  if (!route) throw new HttpError(404, `Route not found: ${method} /api${path}`);
  const m = path.match(route.rx);
  const p = Object.fromEntries(route.keys.map((k, i) => [k, decodeURIComponent(m[i + 1])]));
  const query = Object.fromEntries(Object.entries(params || {}).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => [k, String(v)]));
  const user = route.open ? null : currentUser(token);
  const result = route.handler({ user, params: p, query, body: clone(body) || {} });
  if (method !== 'GET' || path.startsWith('/reports/dashboard') || path.startsWith('/shelves')) save();
  return clone(result);
}
