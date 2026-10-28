const { pool, tx } = require('../config/db');
const { fail } = require('../utils/ApiError');
const asyncHandler = require('../utils/asyncHandler');
const L = require('../utils/lib');

/* ================================= Books ================================= */

const SORTS = {
  az: 'b.title ASC',
  za: 'b.title DESC',
  newest: 'b.created_at DESC, b.book_id DESC',
  oldest: 'b.created_at ASC, b.book_id ASC',
  price_asc: 'b.price ASC',
  price_desc: 'b.price DESC',
  popular: 'b.times_borrowed DESC, b.title ASC',
};

/** Builds the WHERE clause for book searches (shared with the AI assistant). */
function bookFilter(q = {}) {
  const where = [];
  const params = [];
  if (q.search) {
    const term = String(q.search).trim();
    const like = `%${term}%`;
    const parts = ['b.title', 'b.isbn', 'a.name', 'b.publisher', 'c.name', 'b.book_code', 'b.language', 'b.subcategory', 's.section'].map((col) => `${col} LIKE ?`);
    parts.forEach(() => params.push(like));
    const shelfM = term.match(/^(?:shelf\s*|sh-)?([a-z]{1,2})$/i);
    const rackM = term.match(/^rack\s*(\d+)$/i);
    if (shelfM) {
      parts.push('s.code = ?');
      params.push(shelfM[1].toUpperCase());
    }
    if (rackM) {
      parts.push('b.rack = ?');
      params.push(rackM[1].padStart(2, '0'));
    }
    where.push(`(${parts.join(' OR ')})`);
  }
  if (q.category) {
    where.push(L.isPk(q.category) ? 'b.category_id = ?' : 'c.name = ?');
    params.push(q.category);
  }
  if (q.author) {
    if (L.isPk(q.author)) {
      where.push('b.author_id = ?');
      params.push(q.author);
    } else {
      where.push('a.name LIKE ?');
      params.push(`%${q.author}%`);
    }
  }
  if (q.language) {
    where.push('b.language = ?');
    params.push(q.language);
  }
  if (q.floor) {
    where.push('s.floor = ?');
    params.push(Number(q.floor));
  }
  if (q.shelf) {
    if (L.isPk(q.shelf)) {
      where.push('b.shelf_id = ?');
      params.push(q.shelf);
    } else {
      where.push('s.code = ?');
      params.push(String(q.shelf).toUpperCase().replace(/^SH-/, ''));
    }
  }
  if (q.rack) {
    where.push('b.rack = ?');
    params.push(String(q.rack).padStart(2, '0'));
  }
  if (q.minPrice) {
    where.push('b.price >= ?');
    params.push(Number(q.minPrice));
  }
  if (q.maxPrice) {
    where.push('b.price <= ?');
    params.push(Number(q.maxPrice));
  }
  const status = {
    available: 'b.available_copies > 0',
    issued: 'b.issued_copies > 0',
    reserved: `(b.reserved_copies > 0 OR EXISTS (SELECT 1 FROM reservations r WHERE r.book_id = b.book_id AND r.status IN ('Waiting','Available')))`,
    overdue: `EXISTS (SELECT 1 FROM loans l WHERE l.book_id = b.book_id AND l.status = 'Overdue')`,
    lost: 'b.lost_copies > 0',
    damaged: 'b.damaged_copies > 0',
    unavailable: 'b.available_copies = 0',
  }[String(q.status || '').toLowerCase()];
  if (status) where.push(status);
  return { sql: where.length ? `WHERE ${where.join(' AND ')}` : '', params };
}

async function searchBooks(q, { defLimit = 12, maxLimit = 500, orderBy } = {}) {
  const { sql, params } = bookFilter(q);
  const pg = L.paginate(q, defLimit, maxLimit);
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM books b JOIN authors a ON a.author_id = b.author_id JOIN categories c ON c.category_id = b.category_id
     LEFT JOIN shelves s ON s.shelf_id = b.shelf_id ${sql}`,
    params
  );
  const [rows] = await pool.query(`${L.BOOK_SQL} ${sql} ORDER BY ${orderBy || SORTS[q.sort] || SORTS.newest} LIMIT ? OFFSET ?`, [
    ...params,
    pg.limit,
    pg.offset,
  ]);
  return { rows, pagination: L.pageInfo(pg, total) };
}
exports.searchBooks = searchBooks;

exports.listBooks = asyncHandler(async (req, res) => {
  const { rows, pagination } = await searchBooks(req.query);
  const [overdue] = rows.length
    ? await pool.query(`SELECT DISTINCT book_id FROM loans WHERE status = 'Overdue' AND book_id IN (?)`, [rows.map((r) => r.book_id)])
    : [[]];
  const od = new Set(overdue.map((r) => r.book_id));
  res.json({ success: true, data: rows.map((r) => ({ ...L.bookOut(r, { shelfObject: true }), hasOverdue: od.has(r.book_id) })), pagination });
});

exports.bookMeta = asyncHandler(async (req, res) => {
  const [langs] = await pool.query('SELECT DISTINCT language FROM books ORDER BY language');
  const [pubs] = await pool.query(`SELECT DISTINCT publisher FROM books WHERE publisher <> '' ORDER BY publisher`);
  const [cats] = await pool.query('SELECT category_id, name FROM categories ORDER BY name');
  const [floors] = await pool.query('SELECT DISTINCT floor FROM shelves ORDER BY floor');
  res.json({
    success: true,
    data: {
      languages: langs.map((r) => r.language),
      publishers: pubs.map((r) => r.publisher),
      categories: cats.map((c) => ({ _id: L.id(c.category_id), name: c.name })),
      floors: floors.map((r) => r.floor),
    },
  });
});

// GET /books/recommendations — scored from borrowing history, search history and popularity
exports.recommendations = asyncHandler(async (req, res) => {
  const user = req.user;
  let memberId = user.memberId;
  if (user.role !== 'student' && req.query.member) memberId = (await L.findMemberRow(pool, req.query.member)).member_id;
  const [history] = memberId
    ? await pool.query('SELECT l.book_id, b.category_id, b.author_id FROM loans l JOIN books b ON b.book_id = l.book_id WHERE l.member_id = ?', [memberId])
    : [[]];
  const read = new Set(history.map((h) => h.book_id));
  const catScore = {};
  const authScore = {};
  history.forEach((h) => {
    catScore[h.category_id] = (catScore[h.category_id] || 0) + 1;
    authScore[h.author_id] = (authScore[h.author_id] || 0) + 1;
  });
  const terms = L.parseJson(user.search_history, []).slice(0, 5);
  const termRx = terms.map((t) => new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  const [all] = await pool.query(L.BOOK_SQL);
  const cands = all.filter((b) => !read.has(b.book_id));
  const maxB = Math.max(1, ...cands.map((b) => b.times_borrowed));
  const scored = cands.map((b) => {
    let score = (b.times_borrowed / maxB) * 2;
    const reasons = [];
    if (catScore[b.category_id]) {
      score += catScore[b.category_id] * 2;
      reasons.push(`Because you read ${b.category_name}`);
    }
    if (authScore[b.author_id]) {
      score += authScore[b.author_id] * 3;
      reasons.push(`More by ${b.author_name}`);
    }
    if (termRx.some((rx) => rx.test(b.title) || rx.test(b.author_name) || rx.test(b.category_name))) {
      score += 2.5;
      reasons.push('Matches your searches');
    }
    if (b.available_copies > 0) score += 0.5;
    if (!reasons.length) reasons.push(b.times_borrowed > maxB / 2 ? 'Popular in the library' : 'Trending pick');
    return { ...L.bookOut(b), score, reason: reasons[0] };
  });
  scored.sort((a, b) => b.score - a.score);
  res.json({ success: true, data: scored.slice(0, Number(req.query.limit) || 8), basedOn: { borrowed: history.length, searches: terms } });
});

exports.getBook = asyncHandler(async (req, res) => {
  const user = req.user;
  const b = await L.findBookRow(pool, decodeURIComponent(req.params.id));
  const out = L.bookOut(b);
  const [[author]] = await pool.query('SELECT * FROM authors WHERE author_id = ?', [b.author_id]);
  const [[cat]] = await pool.query('SELECT * FROM categories WHERE category_id = ?', [b.category_id]);
  out.author = L.authorOut(author);
  out.category = L.sel(L.categoryOut(cat), ['name', 'icon', 'categoryId']);
  if (b.shelf_id) out.location.shelf = L.shelfOut((await pool.query(`${L.SHELF_SQL} WHERE s.shelf_id = ?`, [b.shelf_id]))[0][0]);

  const [issues] = await pool.query(`${L.LOAN_SQL} WHERE l.book_id = ? AND l.status IN ('Issued','Overdue') ORDER BY l.due_date`, [b.book_id]);
  const [queue] = await pool.query(
    `SELECT r.*, m.member_code, m.name AS member_name FROM reservations r JOIN members m ON m.member_id = r.member_id
     WHERE r.book_id = ? AND r.status IN ('Waiting','Available') ORDER BY r.status, r.reservation_date`,
    [b.book_id]
  );
  const [similar] = await pool.query(
    `${L.BOOK_SQL} WHERE b.book_id <> ? AND (b.category_id = ? OR b.author_id = ?) ORDER BY b.times_borrowed DESC LIMIT 6`,
    [b.book_id, b.category_id, b.author_id]
  );
  const staff = L.isStaff(user);
  const reservations = queue
    .filter((r) => staff || r.member_id === user.memberId)
    .map((r) => ({ ...L.reservationOut(r), member: { _id: L.id(r.member_id), memberId: r.member_code, name: r.member_name } }));
  res.json({
    success: true,
    data: out,
    activeIssues: issues.filter((i) => staff || i.member_id === user.memberId).map(L.issueOut),
    nextDue: issues[0]?.due_date || null,
    reservations,
    queueLength: queue.filter((r) => r.status === 'Waiting').length,
    similar: similar.map((r) => L.bookOut(r)),
  });
});

async function resolveAuthor(c, body) {
  if (body.author && L.isPk(body.author)) {
    const [[a]] = await c.query('SELECT * FROM authors WHERE author_id = ?', [body.author]);
    if (!a) fail(400, 'Selected author does not exist');
    return a;
  }
  const name = String(body.authorName || body.author || '').trim();
  if (!name) fail(400, 'Author is required', { authorName: 'Author is required' });
  const [[a]] = await c.query('SELECT * FROM authors WHERE name = ?', [name]);
  if (a) return a;
  const [ins] = await c.query(`INSERT INTO authors (name, biography, country, profile_image) VALUES (?, '', '', '')`, [name]);
  await L.assignCode(c, 'authors', 'author_id', 'author_code', 'AUT', 3, ins.insertId);
  return { author_id: ins.insertId, name };
}

async function resolveCategory(c, body) {
  const ref = body.category || body.categoryName;
  if (!ref) fail(400, 'Category is required', { category: 'Category is required' });
  const [[cat]] = await c.query(`SELECT * FROM categories WHERE ${L.isPk(ref) ? 'category_id' : 'name'} = ?`, [ref]);
  if (!cat) fail(400, 'Selected category does not exist');
  return cat;
}

async function resolveLocation(c, loc) {
  if (!loc || !loc.shelf) fail(400, 'Shelf location is required', { shelf: 'Shelf is required' });
  const s = await L.findShelfRow(c, loc.shelf);
  const rack = String(loc.rack || '').trim();
  const row = String(loc.row || '').trim().toUpperCase();
  const position = String(loc.position || '').trim();
  if (!rack || !row || !position) fail(400, 'Rack, row and position are required');
  if (!/^\d{1,3}$/.test(rack) || Number(rack) < 1 || Number(rack) > s.racks) fail(400, `Rack must be between 1 and ${s.racks} for ${s.name}`, { rack: `1–${s.racks}` });
  if (!/^[A-Z]$/.test(row) || row.charCodeAt(0) - 64 > s.rows_per_rack) {
    fail(400, `Row must be between A and ${String.fromCharCode(64 + s.rows_per_rack)} for ${s.name}`, { row: `A–${String.fromCharCode(64 + s.rows_per_rack)}` });
  }
  if (!/^\d{1,3}$/.test(position) || Number(position) < 1) fail(400, 'Position must be a positive number', { position: 'Must be a positive number' });
  return { shelf: s, rack: rack.padStart(2, '0'), row, position: position.padStart(2, '0') };
}

const NUM_FIELDS = { pages: 'pages', price: 'price', purchasePrice: 'purchase_price', currentValue: 'current_value', quantity: 'quantity', lostCopies: 'lost_copies', damagedCopies: 'damaged_copies' };
const TEXT_FIELDS = { title: 'title', isbn: 'isbn', publisher: 'publisher', edition: 'edition', language: 'language', subcategory: 'subcategory', description: 'description', coverImage: 'cover_image' };

function validateBook(body, partial) {
  const errors = {};
  if (!partial || body.title !== undefined) if (!String(body.title || '').trim()) errors.title = 'Book name is required';
  if (!partial || body.isbn !== undefined) if (!/^(97[89])?\d{9}[\dX]$/.test(String(body.isbn || ''))) errors.isbn = 'ISBN must be a valid ISBN-10 or ISBN-13 (digits only)';
  if (!partial || body.price !== undefined) if (body.price === '' || !(Number(body.price) >= 0)) errors.price = 'Price is required';
  if (!partial || body.quantity !== undefined) if (!(Number(body.quantity) >= 1)) errors.quantity = 'Quantity must be at least 1';
  ['pages', 'purchasePrice', 'currentValue', 'lostCopies', 'damagedCopies'].forEach((k) => {
    if (body[k] !== undefined && body[k] !== '' && !(Number(body[k]) >= 0)) errors[k] = 'Must be zero or more';
  });
  if (body.publicationDate && Number.isNaN(new Date(body.publicationDate).getTime())) errors.publicationDate = 'Invalid date';
  if (Object.keys(errors).length) fail(400, Object.values(errors)[0], errors);
}

function bookColumns(body) {
  const cols = {};
  Object.entries(TEXT_FIELDS).forEach(([k, col]) => {
    if (body[k] !== undefined) cols[col] = String(body[k] ?? '').trim();
  });
  Object.entries(NUM_FIELDS).forEach(([k, col]) => {
    if (body[k] !== undefined && body[k] !== '') cols[col] = Number(body[k]);
  });
  if (body.publicationDate !== undefined) cols.publication_date = body.publicationDate ? new Date(body.publicationDate) : null;
  return cols;
}

async function bookById(db, bookId) {
  const [[r]] = await db.query(`${L.BOOK_SQL} WHERE b.book_id = ?`, [bookId]);
  return L.bookOut(r);
}

exports.createBook = asyncHandler(async (req, res) => {
  const body = req.body;
  validateBook(body, false);
  const book = await tx(async (c) => {
    const a = await resolveAuthor(c, body);
    const cat = await resolveCategory(c, body);
    const loc = await resolveLocation(c, body.location);
    const cols = { edition: '1st', language: 'English', ...bookColumns(body) };
    cols.lost_copies = cols.lost_copies || 0;
    cols.current_value = cols.current_value || cols.price;
    await L.assertShelfSpace(c, loc.shelf, cols.quantity - cols.lost_copies);
    Object.assign(cols, {
      author_id: a.author_id,
      category_id: cat.category_id,
      shelf_id: loc.shelf.shelf_id,
      rack: loc.rack,
      shelf_row: loc.row,
      position: loc.position,
      added_by: req.user.user_id,
    });
    const keys = Object.keys(cols);
    const [ins] = await c.query(`INSERT INTO books (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, keys.map((k) => cols[k]));
    await L.assignCode(c, 'books', 'book_id', 'book_code', 'BK', 4, ins.insertId);
    await L.recalcBook(c, ins.insertId);
    const out = await bookById(c, ins.insertId);
    await L.notify(c, {
      audience: 'all',
      type: 'new-book',
      title: 'New book added',
      message: `"${out.title}" by ${a.name} is now in ${cat.name} — Floor ${out.location.floor}, Shelf ${out.location.shelfCode}.`,
      link: `book-details.html?id=${out.bookId}`,
    });
    return out;
  });
  res.status(201).json({ success: true, data: book });
});

exports.updateBook = asyncHandler(async (req, res) => {
  const body = req.body;
  validateBook(body, true);
  const book = await tx(async (c) => {
    const b = await L.findBookRow(c, req.params.id, { lock: true });
    const cols = bookColumns(body);
    if (body.author || body.authorName) cols.author_id = (await resolveAuthor(c, body)).author_id;
    if (body.category || body.categoryName) cols.category_id = (await resolveCategory(c, body)).category_id;
    let shelf = null;
    if (body.location) {
      const loc = await resolveLocation(c, body.location);
      shelf = loc.shelf;
      Object.assign(cols, { shelf_id: shelf.shelf_id, rack: loc.rack, shelf_row: loc.row, position: loc.position });
    }
    const next = { quantity: b.quantity, lost: b.lost_copies, damaged: b.damaged_copies };
    if (cols.quantity !== undefined) next.quantity = cols.quantity;
    if (cols.lost_copies !== undefined) next.lost = cols.lost_copies;
    if (cols.damaged_copies !== undefined) next.damaged = cols.damaged_copies;
    const [[{ active }]] = await c.query(`SELECT COUNT(*) AS active FROM loans WHERE book_id = ? AND status IN ('Issued','Overdue')`, [b.book_id]);
    if (next.quantity < active + next.lost + next.damaged) fail(400, `Quantity cannot be lower than issued (${active}) + lost + damaged copies`);
    if (shelf) await L.assertShelfSpace(c, shelf, next.quantity - next.lost, b.book_id);
    // Keep available_copies within the CHECK range until recalcBook runs.
    cols.available_copies = Math.min(b.available_copies, next.quantity);
    const keys = Object.keys(cols);
    if (keys.length) await c.query(`UPDATE books SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE book_id = ?`, [...keys.map((k) => cols[k]), b.book_id]);
    await L.processReservationQueue(c, b.book_id);
    return bookById(c, b.book_id);
  });
  res.json({ success: true, data: book });
});

// PATCH /books/:id/location  { shelf, rack, row, position }
exports.moveBook = asyncHandler(async (req, res) => {
  const book = await tx(async (c) => {
    const b = await L.findBookRow(c, req.params.id, { lock: true });
    const loc = await resolveLocation(c, req.body);
    if (loc.shelf.shelf_id !== b.shelf_id) await L.assertShelfSpace(c, loc.shelf, b.quantity - b.lost_copies, b.book_id);
    await c.query('UPDATE books SET shelf_id = ?, rack = ?, shelf_row = ?, position = ? WHERE book_id = ?', [loc.shelf.shelf_id, loc.rack, loc.row, loc.position, b.book_id]);
    const out = await bookById(c, b.book_id);
    const l = out.location;
    await L.notify(c, {
      title: 'Book moved',
      message: `"${out.title}" moved to Floor ${l.floor}, ${l.section}, Shelf ${l.shelfCode}, Rack ${l.rack}, Row ${l.row}, Position ${l.position}.`,
      link: `book-details.html?id=${out.bookId}`,
    });
    return out;
  });
  res.json({ success: true, data: book });
});

async function deleteBookRow(c, b) {
  const [[{ active }]] = await c.query(`SELECT COUNT(*) AS active FROM loans WHERE book_id = ? AND status IN ('Issued','Overdue')`, [b.book_id]);
  if (active) fail(400, `"${b.title}" has ${active} copy(s) currently issued and cannot be deleted`);
  const [[{ history }]] = await c.query('SELECT COUNT(*) AS history FROM loans WHERE book_id = ?', [b.book_id]);
  if (history) fail(400, `"${b.title}" has loan history and cannot be deleted. Set its quantity or mark copies lost instead.`);
  await c.query('DELETE FROM books WHERE book_id = ?', [b.book_id]);
}

exports.deleteBook = asyncHandler(async (req, res) => {
  await tx(async (c) => deleteBookRow(c, await L.findBookRow(c, req.params.id, { lock: true })));
  res.json({ success: true, message: 'Book deleted' });
});

// POST /books/bulk  { ids: [...], action: 'delete' | 'category' | 'move', category?, shelf? }
exports.bulkBooks = asyncHandler(async (req, res) => {
  const { ids, action } = req.body;
  if (!Array.isArray(ids) || !ids.length) fail(400, 'Select at least one book');
  const numeric = ids.map(Number).filter(Number.isInteger);
  const results = { ok: 0, failed: [] };
  if (action === 'delete') {
    const [books] = await pool.query('SELECT book_id, book_code, title FROM books WHERE book_id IN (?)', [numeric]);
    for (const b of books) {
      try {
        await tx((c) => deleteBookRow(c, b));
        results.ok += 1;
      } catch (e) {
        results.failed.push({ id: b.book_code, reason: e.message });
      }
    }
  } else if (action === 'category') {
    await tx(async (c) => {
      const cat = await resolveCategory(c, req.body);
      const [r] = await c.query('UPDATE books SET category_id = ? WHERE book_id IN (?)', [cat.category_id, numeric]);
      results.ok = r.affectedRows;
    });
  } else if (action === 'move') {
    await tx(async (c) => {
      const s = await L.findShelfRow(c, req.body.shelf);
      const [[{ incoming }]] = await c.query(
        'SELECT COALESCE(SUM(quantity - lost_copies), 0) AS incoming FROM books WHERE book_id IN (?) AND (shelf_id IS NULL OR shelf_id <> ?)',
        [numeric, s.shelf_id]
      );
      await L.assertShelfSpace(c, s, Number(incoming));
      // Books moved without explicit coordinates keep rack/row/position, clamped to the target shelf's layout.
      const [r] = await c.query(
        `UPDATE books SET shelf_id = ?, rack = LPAD(LEAST(CAST(rack AS UNSIGNED), ?), 2, '0'),
           shelf_row = IF(ORD(shelf_row) - 64 > ?, CHAR(64 + ?), shelf_row) WHERE book_id IN (?)`,
        [s.shelf_id, s.racks, s.rows_per_rack, s.rows_per_rack, numeric]
      );
      results.ok = r.affectedRows;
    });
  } else fail(400, 'Unknown bulk action');
  res.json({ success: true, data: results, message: `${results.ok} book(s) updated${results.failed.length ? `, ${results.failed.length} skipped` : ''}` });
});

/* ================================ Authors ================================ */

const AUTHOR_STATS = `
  SELECT a.*, COUNT(b.book_id) AS book_count, COALESCE(SUM(b.quantity), 0) AS total_copies, COALESCE(SUM(b.times_borrowed), 0) AS times_borrowed
  FROM authors a LEFT JOIN books b ON b.author_id = a.author_id`;
const authorWithStats = (r) => ({ ...L.authorOut(r), bookCount: Number(r.book_count), totalCopies: Number(r.total_copies), timesBorrowed: Number(r.times_borrowed) });

async function findAuthor(db, ref) {
  const [[a]] = await db.query(`SELECT * FROM authors WHERE ${L.isPk(ref) ? 'author_id' : 'author_code'} = ?`, [L.isPk(ref) ? ref : String(ref).toUpperCase()]);
  if (!a) fail(404, 'Author not found');
  return a;
}

exports.listAuthors = asyncHandler(async (req, res) => {
  const search = req.query.search ? 'WHERE a.name LIKE ?' : '';
  const [rows] = await pool.query(`${AUTHOR_STATS} ${search} GROUP BY a.author_id ORDER BY a.name`, req.query.search ? [`%${req.query.search}%`] : []);
  res.json({ success: true, data: rows.map(authorWithStats) });
});

exports.getAuthor = asyncHandler(async (req, res) => {
  const a = await findAuthor(pool, req.params.id);
  const [books] = await pool.query(`${L.BOOK_SQL} WHERE b.author_id = ? ORDER BY b.title`, [a.author_id]);
  res.json({ success: true, data: { ...L.authorOut(a), bookCount: books.length }, books: books.map((b) => L.bookOut(b)) });
});

exports.createAuthor = asyncHandler(async (req, res) => {
  const { name, biography = '', country = '', profileImage = '' } = req.body;
  if (!String(name || '').trim()) fail(400, 'Name is required', { name: 'Name is required' });
  const data = await tx(async (c) => {
    const [ins] = await c.query('INSERT INTO authors (name, biography, country, profile_image) VALUES (?, ?, ?, ?)', [name.trim(), biography, country, profileImage]);
    await L.assignCode(c, 'authors', 'author_id', 'author_code', 'AUT', 3, ins.insertId);
    return L.authorOut((await c.query('SELECT * FROM authors WHERE author_id = ?', [ins.insertId]))[0][0]);
  });
  res.status(201).json({ success: true, data });
});

exports.updateAuthor = asyncHandler(async (req, res) => {
  const a = await findAuthor(pool, req.params.id);
  const { name, biography, country, profileImage } = req.body;
  if (name !== undefined && !String(name).trim()) fail(400, 'Name is required', { name: 'Name is required' });
  await pool.query(
    'UPDATE authors SET name = COALESCE(?, name), biography = COALESCE(?, biography), country = COALESCE(?, country), profile_image = COALESCE(?, profile_image) WHERE author_id = ?',
    [name ? name.trim() : null, biography ?? null, country ?? null, profileImage ?? null, a.author_id]
  );
  res.json({ success: true, data: L.authorOut((await pool.query('SELECT * FROM authors WHERE author_id = ?', [a.author_id]))[0][0]) });
});

exports.deleteAuthor = asyncHandler(async (req, res) => {
  const a = await findAuthor(pool, req.params.id);
  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM books WHERE author_id = ?', [a.author_id]);
  if (n) fail(400, `Cannot delete: ${n} book(s) are linked to this author`);
  await pool.query('DELETE FROM authors WHERE author_id = ?', [a.author_id]);
  res.json({ success: true, message: 'Author deleted' });
});

/* =============================== Categories =============================== */

async function findCategory(db, ref) {
  const [[c]] = await db.query(`SELECT * FROM categories WHERE ${L.isPk(ref) ? 'category_id' : 'category_code'} = ?`, [L.isPk(ref) ? ref : String(ref).toUpperCase()]);
  if (!c) fail(404, 'Category not found');
  return c;
}

exports.listCategories = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT c.*, COUNT(b.book_id) AS titles, COALESCE(SUM(b.quantity), 0) AS total_books, COALESCE(SUM(b.available_copies), 0) AS available_books,
       COALESCE(SUM(b.issued_copies), 0) AS issued_books, COALESCE(SUM(b.reserved_copies), 0) AS reserved_books
     FROM categories c LEFT JOIN books b ON b.category_id = c.category_id GROUP BY c.category_id ORDER BY c.name`
  );
  res.json({
    success: true,
    data: rows.map((r) => ({
      ...L.categoryOut(r),
      titles: Number(r.titles),
      totalBooks: Number(r.total_books),
      availableBooks: Number(r.available_books),
      issuedBooks: Number(r.issued_books),
      reservedBooks: Number(r.reserved_books),
    })),
  });
});

exports.getCategory = asyncHandler(async (req, res) => {
  const cat = await findCategory(pool, req.params.id);
  const [books] = await pool.query(`${L.BOOK_SQL} WHERE b.category_id = ? ORDER BY b.title`, [cat.category_id]);
  res.json({ success: true, data: L.categoryOut(cat), books: books.map((b) => L.bookOut(b)) });
});

const subcats = (v) => JSON.stringify(Array.isArray(v) ? v.map((s) => String(s).trim()).filter(Boolean) : String(v || '').split(',').map((s) => s.trim()).filter(Boolean));

exports.createCategory = asyncHandler(async (req, res) => {
  const { name, description = '', icon = '📚', subcategories = [] } = req.body;
  if (!String(name || '').trim()) fail(400, 'Name is required', { name: 'Name is required' });
  const data = await tx(async (c) => {
    const [ins] = await c.query('INSERT INTO categories (name, description, icon, subcategories) VALUES (?, ?, ?, ?)', [name.trim(), description, icon || '📚', subcats(subcategories)]);
    await L.assignCode(c, 'categories', 'category_id', 'category_code', 'CAT', 3, ins.insertId);
    return L.categoryOut((await c.query('SELECT * FROM categories WHERE category_id = ?', [ins.insertId]))[0][0]);
  });
  res.status(201).json({ success: true, data });
});

exports.updateCategory = asyncHandler(async (req, res) => {
  const cat = await findCategory(pool, req.params.id);
  const { name, description, icon, subcategories } = req.body;
  if (name !== undefined && !String(name).trim()) fail(400, 'Name is required', { name: 'Name is required' });
  await pool.query(
    'UPDATE categories SET name = COALESCE(?, name), description = COALESCE(?, description), icon = COALESCE(?, icon), subcategories = COALESCE(?, subcategories) WHERE category_id = ?',
    [name ? name.trim() : null, description ?? null, icon || null, subcategories === undefined ? null : subcats(subcategories), cat.category_id]
  );
  res.json({ success: true, data: L.categoryOut((await pool.query('SELECT * FROM categories WHERE category_id = ?', [cat.category_id]))[0][0]) });
});

exports.deleteCategory = asyncHandler(async (req, res) => {
  const cat = await findCategory(pool, req.params.id);
  const [[{ n }]] = await pool.query('SELECT COUNT(*) AS n FROM books WHERE category_id = ?', [cat.category_id]);
  if (n) fail(400, `Cannot delete: ${n} book(s) belong to this category`);
  await pool.query('DELETE FROM categories WHERE category_id = ?', [cat.category_id]);
  res.json({ success: true, message: 'Category deleted' });
});

/* ================================= Shelves ================================= */

exports.listShelves = asyncHandler(async (req, res) => {
  const where = req.query.floor ? 'WHERE s.floor = ?' : '';
  const [rows] = await pool.query(`${L.SHELF_SQL} ${where} ORDER BY s.floor, s.section, s.code`, req.query.floor ? [Number(req.query.floor)] : []);
  res.json({ success: true, data: rows.map(L.shelfOut) });
});

exports.getShelf = asyncHandler(async (req, res) => {
  const s = await L.findShelfRow(pool, req.params.id);
  const [books] = await pool.query(`${L.BOOK_SQL} WHERE b.shelf_id = ? ORDER BY b.rack, b.shelf_row, b.position`, [s.shelf_id]);
  res.json({ success: true, data: L.shelfOut(s), books: books.map((b) => L.bookOut(b)) });
});

function shelfBody(body, partial) {
  const errors = {};
  const out = {};
  if (body.code !== undefined) {
    out.code = String(body.code).trim().toUpperCase();
    if (!/^[A-Z]{1,3}$/.test(out.code)) errors.code = 'Use 1–3 letters';
  }
  if (body.name !== undefined) out.name = String(body.name).trim();
  if (body.section !== undefined) out.section = String(body.section).trim();
  if (body.status !== undefined) out.status = String(body.status);
  [['floor', 'floor'], ['racks', 'racks'], ['rowsPerRack', 'rows_per_rack'], ['capacity', 'capacity']].forEach(([k, col]) => {
    if (body[k] !== undefined && body[k] !== '') {
      out[col] = Number(body[k]);
      if (!Number.isInteger(out[col]) || out[col] < (k === 'floor' ? 0 : 1)) errors[k] = 'Must be a positive whole number';
    }
  });
  if (out.rows_per_rack > 26) errors.rowsPerRack = 'At most 26 rows (A–Z)';
  if (body.category !== undefined) out.category_id = body.category ? Number(body.category) : null;
  if (!partial) {
    if (!out.code) errors.code = errors.code || 'Shelf code is required';
    if (out.floor === undefined) errors.floor = 'Floor is required';
    if (!out.section) errors.section = 'Section is required';
    if (!out.capacity) errors.capacity = errors.capacity || 'Capacity is required';
  }
  if (Object.keys(errors).length) fail(400, Object.values(errors)[0], errors);
  return out;
}

exports.createShelf = asyncHandler(async (req, res) => {
  const b = shelfBody(req.body, false);
  const cols = { racks: 4, rows_per_rack: 4, status: 'Active', ...b, name: b.name || `Shelf ${b.code}` };
  const keys = Object.keys(cols);
  const [ins] = await pool.query(`INSERT INTO shelves (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, keys.map((k) => cols[k]));
  res.status(201).json({ success: true, data: L.shelfOut((await pool.query(`${L.SHELF_SQL} WHERE s.shelf_id = ?`, [ins.insertId]))[0][0]) });
});

exports.updateShelf = asyncHandler(async (req, res) => {
  const s = await L.findShelfRow(pool, req.params.id);
  const b = shelfBody(req.body, true);
  if (b.capacity !== undefined && b.capacity < Number(s.occupied)) fail(400, `Capacity cannot be less than the ${s.occupied} books currently stored`, { capacity: `At least ${s.occupied}` });
  if (b.code && b.code !== s.code && !b.name) b.name = `Shelf ${b.code}`;
  const keys = Object.keys(b);
  if (keys.length) await pool.query(`UPDATE shelves SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE shelf_id = ?`, [...keys.map((k) => b[k]), s.shelf_id]);
  res.json({ success: true, data: L.shelfOut((await pool.query(`${L.SHELF_SQL} WHERE s.shelf_id = ?`, [s.shelf_id]))[0][0]) });
});

exports.deleteShelf = asyncHandler(async (req, res) => {
  const s = await L.findShelfRow(pool, req.params.id);
  if (Number(s.titles)) fail(400, `Cannot delete: ${s.titles} book title(s) are stored on ${s.name}. Move them first.`);
  await pool.query('DELETE FROM shelves WHERE shelf_id = ?', [s.shelf_id]);
  res.json({ success: true, message: 'Shelf deleted' });
});
