/**
 * Loads the demo library into MySQL: the SmartLib demo snapshot (frontend/js/demo/demo-data.js)
 * converted to Ft with this library's policy (500 Ft/day late fine), plus Hungarian titles.
 * Run: npm run seed:mysql   (wipes and reloads every table)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });
const path = require('path');
const { pathToFileURL } = require('url');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2/promise');

const PRICE_FACTOR = 4; // ₹ → Ft for book prices and membership fees
const FINE_PER_DAY = 500;
const LOST_FEE = 500;
const DAMAGE_PERCENT = 30;

const num = (codeStr) => Number(String(codeStr).replace(/\D/g, ''));
const ft = (inr) => Math.round((Number(inr) * PRICE_FACTOR) / 10) * 10;
const d = (iso) => (iso ? new Date(iso) : null);
const neptun = (seed) => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';
  let h = [...seed].reduce((s, c) => (s * 31 + c.charCodeAt(0)) >>> 0, 7);
  let out = '';
  for (let i = 0; i < 6; i += 1) {
    out += chars[h % chars.length];
    h = Math.floor(h / chars.length) + (i + 1) * 7919;
  }
  return out;
};
const mail = (e) => String(e).toLowerCase().replace(/@smartlib\.com$/, '@library.com');

function shiftDates(obj, delta) {
  const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
  if (Array.isArray(obj)) obj.forEach((x, i) => (typeof x === 'string' && ISO.test(x) ? (obj[i] = new Date(Date.parse(x) + delta).toISOString()) : shiftDates(x, delta)));
  else if (obj && typeof obj === 'object') {
    for (const k of Object.keys(obj)) {
      const v = obj[k];
      if (typeof v === 'string' && ISO.test(v)) obj[k] = new Date(Date.parse(v) + delta).toISOString();
      else if (v && typeof v === 'object') shiftDates(v, delta);
    }
  }
}

const HUNGARIAN = [
  {
    title: 'Üvöltő szelek',
    isbn: '9789630797463',
    author: { name: 'Emily Brontë', country: 'United Kingdom', biography: 'English novelist and poet, author of Wuthering Heights (1847), a classic of English literature.' },
    publisher: 'Európa Könyvkiadó',
    publicationDate: '2015-03-02',
    edition: '12th',
    pages: 432,
    price: 3990,
    quantity: 3,
    timesBorrowed: 6,
    description: 'Heathcliff és Catherine szenvedélyes, sorsszerű szerelmének története a yorkshire-i lápvidéken.',
    location: { shelf: 'B', rack: '02', row: 'C', position: '03' },
  },
  {
    title: 'Az arany ember',
    isbn: '9789632522278',
    author: { name: 'Jókai Mór', country: 'Hungary', biography: 'Hungarian novelist and dramatist, one of the most widely read authors of 19th-century Hungarian literature.' },
    publisher: 'Unikornis',
    publicationDate: '2011-09-15',
    edition: 'Classic',
    pages: 512,
    price: 2990,
    quantity: 3,
    timesBorrowed: 9,
    description: 'Tímár Mihály, a komáromi hajóbiztos kettős életének regénye a Duna partjától a Senki szigetéig.',
    location: { shelf: 'B', rack: '02', row: 'C', position: '04' },
  },
];

async function seed() {
  const snapshotPath = path.join(__dirname, '..', '..', 'frontend', 'js', 'demo', 'demo-data.js');
  const data = JSON.parse(JSON.stringify((await import(pathToFileURL(snapshotPath).href)).default));
  shiftDates(data, Date.now() - Date.parse(data.snapshotAt));

  const conn = await mysql.createConnection({
    host: process.env.MYSQL_HOST || 'localhost',
    port: Number(process.env.MYSQL_PORT) || 3306,
    user: process.env.MYSQL_USER || 'root',
    password: process.env.MYSQL_PASSWORD || '',
    database: process.env.MYSQL_DATABASE || 'library_app',
    charset: 'utf8mb4',
  });
  const q = (sql, params) => conn.query(sql, params);
  const ids = { users: {}, members: {}, authors: {}, categories: {}, shelves: {}, books: {}, issues: {}, fines: {}, notifications: {} };

  try {
    await q('SET FOREIGN_KEY_CHECKS = 0');
    for (const t of ['notification_reads', 'notifications', 'fine_payments', 'fines', 'reservations', 'loans', 'books', 'shelves', 'categories', 'authors', 'members', 'users']) {
      await q(`TRUNCATE TABLE ${t}`);
    }
    await q('SET FOREIGN_KEY_CHECKS = 1');
    await conn.beginTransaction();

    // Users (admin, librarian, staff, student) — same passwords as the demo, emails on @library.com
    let uid = 0;
    for (const u of data.users) {
      uid += 1;
      ids.users[u._id] = uid;
      await q('INSERT INTO users (user_id, name, email, password_hash, role, avatar, is_active, search_history, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', [
        uid,
        u.name,
        mail(u.email),
        await bcrypt.hash(u.password, 10),
        u.role,
        u.avatar || '',
        u.isActive ? 1 : 0,
        JSON.stringify(u.searchHistory || []),
        d(u.createdAt),
      ]);
    }

    for (const m of data.members) {
      const id = num(m.memberId);
      ids.members[m._id] = id;
      await q(
        `INSERT INTO members (member_id, member_code, user_id, name, email, phone, neptun_code, profile_photo, department, course, year,
           membership_type, membership_start, membership_expiry, status, expiry_notified, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, m.memberId, m.user ? ids.users[m.user] : null, m.name, mail(m.email), m.phone || null, neptun(m.memberId + m.name), m.profilePhoto || '', m.department || '', m.course || '', m.year || '',
          m.membershipType, d(m.membershipStart), d(m.membershipExpiry), m.status, m.expiryNotified ? 1 : 0, d(m.createdAt)]
      );
    }

    for (const a of data.authors) {
      const id = num(a.authorId);
      ids.authors[a._id] = id;
      await q('INSERT INTO authors (author_id, author_code, name, biography, country, profile_image, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
        id, a.authorId, a.name, a.biography || '', a.country || '', a.profileImage || '', d(a.createdAt),
      ]);
    }

    for (const c of data.categories) {
      const id = num(c.categoryId);
      ids.categories[c._id] = id;
      await q('INSERT INTO categories (category_id, category_code, name, description, icon, subcategories, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [
        id, c.categoryId, c.name, c.description || '', c.icon || '📚', JSON.stringify(c.subcategories || []), d(c.createdAt),
      ]);
    }

    let sid = 0;
    const shelfByCode = {};
    for (const s of [...data.shelves].sort((a, b) => a.code.localeCompare(b.code))) {
      sid += 1;
      ids.shelves[s._id] = sid;
      shelfByCode[s.code] = sid;
      await q('INSERT INTO shelves (shelf_id, code, name, floor, section, racks, rows_per_rack, category_id, capacity, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', [
        sid, s.code, s.name, s.floor, s.section, s.racks, s.rowsPerRack, s.category ? ids.categories[s.category] : null, s.capacity, s.status, d(s.createdAt),
      ]);
    }

    const bookPrice = {};
    for (const b of data.books) {
      const id = num(b.bookId);
      ids.books[b._id] = id;
      bookPrice[id] = ft(b.price);
      const l = b.location || {};
      await q(
        `INSERT INTO books (book_id, book_code, title, isbn, author_id, category_id, publisher, publication_date, edition, language, subcategory, description,
           cover_image, pages, price, purchase_price, current_value, quantity, available_copies, issued_copies, reserved_copies, lost_copies, damaged_copies,
           status, times_borrowed, shelf_id, rack, shelf_row, position, added_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, b.bookId, b.title, b.isbn, ids.authors[b.author], ids.categories[b.category], b.publisher || '', d(b.publicationDate), b.edition || '1st', b.language,
          b.subcategory || '', b.description || '', b.coverImage || '', b.pages || 0, ft(b.price), ft(b.purchasePrice || 0), ft(b.currentValue || b.price),
          b.quantity, b.availableCopies, b.issuedCopies, b.reservedCopies, b.lostCopies, b.damagedCopies, b.status, b.timesBorrowed,
          l.shelf ? ids.shelves[l.shelf] : null, l.rack || null, l.row || null, l.position || null, b.addedBy ? ids.users[b.addedBy] : null, d(b.createdAt)]
      );
    }

    // Hungarian titles from the project brief
    let nextBook = Math.max(...Object.values(ids.books));
    let nextAuthor = Math.max(...Object.values(ids.authors));
    const fiction = data.categories.find((c) => c.name === 'Fiction');
    for (const h of HUNGARIAN) {
      nextAuthor += 1;
      nextBook += 1;
      await q('INSERT INTO authors (author_id, author_code, name, biography, country, profile_image) VALUES (?, ?, ?, ?, ?, ?)', [
        nextAuthor, `AUT${String(nextAuthor).padStart(3, '0')}`, h.author.name, h.author.biography, h.author.country, '',
      ]);
      bookPrice[nextBook] = h.price;
      await q(
        `INSERT INTO books (book_id, book_code, title, isbn, author_id, category_id, publisher, publication_date, edition, language, subcategory, description,
           pages, price, purchase_price, current_value, quantity, available_copies, status, times_borrowed, shelf_id, rack, shelf_row, position, added_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Hungarian', 'Classics', ?, ?, ?, ?, ?, ?, ?, 'Available', ?, ?, ?, ?, ?, 2, DATE_SUB(NOW(), INTERVAL 12 DAY))`,
        [nextBook, `BK${String(nextBook).padStart(4, '0')}`, h.title, h.isbn, nextAuthor, ids.categories[fiction._id], h.publisher, new Date(h.publicationDate), h.edition,
          h.description, h.pages, h.price, Math.round(h.price * 0.8), h.price, h.quantity, h.quantity, h.timesBorrowed,
          shelfByCode[h.location.shelf], h.location.rack, h.location.row, h.location.position]
      );
    }

    // Loans = demo issues merged with their returns
    const returnsByIssue = Object.fromEntries(data.returns.map((r) => [r.issue, r]));
    const finesByIssue = {};
    data.fines.forEach((f) => f.issue && (finesByIssue[f.issue] = [...(finesByIssue[f.issue] || []), f]));
    for (const i of data.issues) {
      const id = num(i.transactionId);
      ids.issues[i._id] = id;
      const r = returnsByIssue[i._id];
      const price = bookPrice[ids.books[i.book]];
      let late = 0;
      let dmg = 0;
      let lost = 0;
      if (r) {
        late = r.daysOverdue * FINE_PER_DAY;
        if (r.condition === 'Damaged') dmg = Math.round((price * DAMAGE_PERCENT) / 100);
        if (r.condition === 'Lost') lost = price + LOST_FEE;
      }
      await q(
        `INSERT INTO loans (loan_id, transaction_id, member_id, book_id, issued_by, issue_date, due_date, renewal_count, status, fine_amount, due_soon_notified,
           overdue_notified, return_code, return_date, return_condition, days_overdue, late_fine, damage_charge, lost_charge, remarks, processed_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, i.transactionId, ids.members[i.member], ids.books[i.book], ids.users[i.staff] || null, d(i.issueDate), d(i.dueDate), i.renewalCount, i.status,
          late + dmg + lost, i.dueSoonNotified ? 1 : 0, i.overdueNotified ? 1 : 0, r ? r.returnId : null, r ? d(r.returnDate) : null, r ? r.condition : null,
          r ? r.daysOverdue : 0, late, dmg, lost, r ? r.remarks || '' : '', r ? ids.users[r.processedBy] || null : null, d(i.createdAt)]
      );
    }

    // Fines recalculated with the Ft policy; paid/discount/waived keep their proportions
    const ratio = {};
    const oldToNew = {};
    for (const f of data.fines) {
      const id = num(f.fineId);
      ids.fines[f._id] = id;
      const bookId = f.book ? ids.books[f.book] : null;
      let amount;
      let description = f.description;
      if (f.type === 'Late Fine') {
        amount = f.daysOverdue * FINE_PER_DAY;
        description = `${f.daysOverdue} day(s) late × ${FINE_PER_DAY} Ft/day`;
      } else if (f.type === 'Lost Book') {
        amount = bookPrice[bookId] + LOST_FEE;
        description = `Replacement ${bookPrice[bookId].toLocaleString('en-US')} Ft + processing ${LOST_FEE} Ft`;
      } else if (f.type === 'Damage') {
        amount = Math.round((bookPrice[bookId] * DAMAGE_PERCENT) / 100);
      } else amount = ft(f.originalAmount);
      const k = amount / f.originalAmount;
      ratio[f._id] = k;
      oldToNew[f.originalAmount] = amount;
      const scale = (v) => Math.round(v * k);
      await q(
        `INSERT INTO fines (fine_id, fine_code, member_id, loan_id, book_id, transaction_ref, type, description, days_overdue, rate_per_day, original_amount,
           discount, paid_amount, waived_amount, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, f.fineId, ids.members[f.member], f.issue ? ids.issues[f.issue] : null, bookId, f.issue ? null : f.transactionId || null, f.type, description,
          f.daysOverdue || 0, f.type === 'Late Fine' ? FINE_PER_DAY : 0, amount, scale(f.discount), scale(f.paidAmount), scale(f.waivedAmount), f.status, d(f.createdAt)]
      );
    }

    for (const p of data.payments) {
      const id = num(p.paymentId);
      const amount = p.fine ? Math.round(p.amount * ratio[p.fine]) : ft(p.amount);
      const reason = String(p.reason).replace(/₹10\/day/g, `${FINE_PER_DAY} Ft/day`).replace(/₹(\d[\d,]*)/g, (_, n) => `${ft(n.replace(/,/g, '')).toLocaleString('en-US')} Ft`);
      await q(
        `INSERT INTO fine_payments (payment_id, payment_code, receipt_no, member_id, fine_id, transaction_ref, reason, amount, payment_date, method, status,
           reference, notes, received_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, p.paymentId, p.receiptNo || null, ids.members[p.member], p.fine ? ids.fines[p.fine] : null, p.transactionId || null, reason, amount, d(p.date), p.method,
          p.status, p.reference || '', p.notes || '', ids.users[p.collectedBy] || null, d(p.createdAt)]
      );
    }

    for (const r of data.reservations) {
      const id = num(r.reservationId);
      await q(
        `INSERT INTO reservations (reservation_id, reservation_code, member_id, book_id, reservation_date, queue_position, expiry_date, available_since, status, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, r.reservationId, ids.members[r.member], ids.books[r.book], d(r.reservationDate), r.queuePosition, d(r.expiryDate), d(r.availableSince), r.status,
          ids.users[r.createdBy] || null, d(r.createdAt)]
      );
    }

    // Notifications: amounts rewritten in Ft (fine amounts follow the recalculated fines)
    const money = (n) => `${Number(n).toLocaleString('en-US')} Ft`;
    let nid = 0;
    for (const n of [...data.notifications].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
      nid += 1;
      const message = n.message
        .replace(/₹10\/day/g, `${money(FINE_PER_DAY)}/day`)
        .replace(/₹(\d[\d,]*)/g, (_, v) => {
          const old = Number(v.replace(/,/g, ''));
          return money(oldToNew[old] !== undefined ? oldToNew[old] : ft(old));
        });
      await q('INSERT INTO notifications (notification_id, audience, member_id, type, title, message, link, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', [
        nid, n.audience, n.member ? ids.members[n.member] : null, n.type, n.title, message, n.link || '', d(n.createdAt),
      ]);
      for (const u of n.readBy || []) if (ids.users[u]) await q('INSERT IGNORE INTO notification_reads (notification_id, user_id) VALUES (?, ?)', [nid, ids.users[u]]);
    }
    await q(`INSERT INTO notifications (audience, type, title, message, link) VALUES ('all', 'new-book', 'Új könyvek érkeztek', 'Az arany ember (Jókai Mór) és az Üvöltő szelek (Emily Brontë) most a Floor 1, Shelf B polcon.', 'books.html?sort=newest')`);

    // Settings: this library's policy
    const settings = {
      libraryName: data.settings.libraryName,
      finePerDay: FINE_PER_DAY,
      loanDays: data.settings.loanDays,
      maxRenewals: data.settings.maxRenewals,
      maxBooksPerMember: data.settings.maxBooksPerMember,
      maxPendingFine: 500,
      reservationHoldDays: data.settings.reservationHoldDays,
      reservationValidityDays: data.settings.reservationValidityDays,
      lostProcessingFee: LOST_FEE,
      damageChargePercent: DAMAGE_PERCENT,
      membershipFee: ft(data.settings.membershipFee),
      dueSoonDays: data.settings.dueSoonDays,
      backupPath: './backups',
    };
    for (const [k, v] of Object.entries(settings)) {
      await q('INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)', [k, String(v)]);
    }

    // Recompute every book's counters from loans and reservations
    const [books] = await q('SELECT book_id, quantity, lost_copies, damaged_copies FROM books');
    for (const b of books) {
      const [[{ issued }]] = await q(`SELECT COUNT(*) AS issued FROM loans WHERE book_id = ? AND status IN ('Issued','Overdue')`, [b.book_id]);
      const [[{ reserved }]] = await q(`SELECT COUNT(*) AS reserved FROM reservations WHERE book_id = ? AND status = 'Available'`, [b.book_id]);
      const available = Math.max(0, b.quantity - issued - reserved - b.lost_copies - b.damaged_copies);
      const status = available > 0 ? 'Available' : reserved > 0 ? 'Reserved' : issued > 0 ? 'Issued' : b.lost_copies >= b.quantity ? 'Lost' : b.damaged_copies > 0 ? 'Damaged' : 'Unavailable';
      await q('UPDATE books SET issued_copies = ?, reserved_copies = ?, available_copies = ?, status = ? WHERE book_id = ?', [issued, reserved, available, status, b.book_id]);
    }

    await conn.commit();
    const [[counts]] = await q(
      `SELECT (SELECT COUNT(*) FROM books) books, (SELECT COUNT(*) FROM members) members, (SELECT COUNT(*) FROM loans) loans,
              (SELECT COUNT(*) FROM fines) fines, (SELECT COUNT(*) FROM fine_payments) payments, (SELECT COUNT(*) FROM reservations) reservations`
    );
    console.log('Seed complete:', counts);
    console.log('Logins (email or user ID 1–4):');
    data.users.forEach((u, i) => console.log(`  ${u.role.padEnd(9)} ${mail(u.email).padEnd(24)} ${u.password}   (user ID ${i + 1})`));
  } catch (err) {
    await conn.rollback().catch(() => {});
    throw err;
  } finally {
    await conn.end();
  }
}

if (require.main === module) {
  seed().catch((err) => {
    console.error('Seeding failed:', err.message);
    process.exit(1);
  });
}

module.exports = { seed };
