// Rule-based natural-language assistant: regex/keyword intents mapped to parameterised SQL.
const { pool } = require('../config/db');
const asyncHandler = require('../utils/asyncHandler');
const L = require('../utils/lib');
const { searchBooks } = require('./catalogController');

const escRx = (s = '') => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const sectionLabel = (x = '') => (/section$/i.test(x) ? x : `${x} Section`);
const locationText = (l) => (l ? `Floor ${l.floor}, ${sectionLabel(l.section)}, Shelf ${l.shelfCode}, Rack ${l.rack}, Row ${l.row}, Position ${l.position}` : 'no shelf location recorded');
const aiBook = (b) => ({ ...b, locationText: locationText(b.location) });

const CATEGORY_ALIASES = {
  programming: ['programming', 'coding', 'code', 'software', 'developer', 'programozás'],
  science: ['science', 'scientific', 'physics', 'biology', 'astronomy', 'tudomány'],
  technology: ['technology', 'tech'],
  engineering: ['engineering', 'engineer'],
  mathematics: ['mathematics', 'math', 'maths', 'matematika'],
  history: ['history', 'historical', 'történelem'],
  biography: ['biography', 'biographies', 'autobiography', 'memoir'],
  business: ['business', 'finance', 'management'],
  entrepreneurship: ['entrepreneurship', 'startup', 'startups', 'entrepreneur'],
  'competitive exams': ['competitive', 'exam', 'exams', 'upsc', 'gate', 'aptitude'],
  reference: ['reference', 'dictionary', 'encyclopedia'],
  fiction: ['fiction', 'novel', 'novels', 'story', 'stories', 'regény', 'szépirodalom'],
};
const STOP = new Set('show me list find get give all any the a an of books book with for please some that are is available which what do you have search looking look i want need on in at by'.split(' '));

function parsePrice(text) {
  // ₹500, Rs. 500, INR 500 or 500 rupees; digits may use Indian grouping (1,00,000)
  const n = '(?:₹|rs\\.?|inr)?\\s*(\\d+(?:,\\d{2,3})*(?:\\.\\d+)?)\\s*(?:rupees?|rs\\.?|inr)?';
  const c = (x) => Number(x.replace(/,/g, ''));
  let m = text.match(new RegExp(`between\\s+${n}\\s+(?:and|to|-)\\s+${n}`, 'i'));
  if (m) return { minPrice: c(m[1]), maxPrice: c(m[2]) };
  m = text.match(new RegExp(`(?:under|below|less than|cheaper than|within|upto|up to|<)\\s*${n}`, 'i'));
  if (m) return { maxPrice: c(m[1]) };
  m = text.match(new RegExp(`(?:over|above|more than|greater than|>)\\s*${n}`, 'i'));
  if (m) return { minPrice: c(m[1]) };
  return {};
}

async function parseQuery(text) {
  const lower = text.toLowerCase();
  const q = parsePrice(lower);
  const u = [];
  if (q.maxPrice !== undefined && q.minPrice !== undefined) u.push(`price ${L.money(q.minPrice)}–${L.money(q.maxPrice)}`);
  else if (q.maxPrice !== undefined) u.push(`price under ${L.money(q.maxPrice)}`);
  else if (q.minPrice !== undefined) u.push(`price over ${L.money(q.minPrice)}`);
  const [cats] = await pool.query('SELECT name FROM categories');
  for (const c of cats) {
    const aliases = CATEGORY_ALIASES[c.name.toLowerCase()] || [c.name.toLowerCase()];
    if (aliases.some((a) => new RegExp(`\\b${escRx(a)}\\b`, 'i').test(lower)) || lower.includes(c.name.toLowerCase())) {
      q.category = c.name;
      u.push(`category ${c.name}`);
      break;
    }
  }
  const au = text.match(/\b(?:by|author|written by|from author)\s+([\p{L}][\p{L}.\s'-]+?)(?=\s+(?:under|below|over|above|on|in|at|between|priced|that|which|with|available)\b|[?.,!]|$)/iu);
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
  const [langs] = await pool.query('SELECT DISTINCT language FROM books');
  const lang = langs.map((r) => r.language).find((l) => new RegExp(`\\b${escRx(l)}\\b`, 'i').test(lower));
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
    const words = lower.replace(/[^\p{L}0-9\s]/gu, ' ').split(/\s+/).filter((w) => w && !STOP.has(w));
    if (words.length) {
      q.search = words.join(' ');
      u.push(`keywords "${q.search}"`);
    }
  }
  return { q, understood: u };
}

async function titleSearch(term) {
  const clean = term.replace(/[?."'!]/g, '').replace(/^(the book|book)\s+/i, '').trim();
  if (!clean) return [];
  const [all] = await pool.query(L.BOOK_SQL);
  const books = all.map((b) => L.bookOut(b));
  let r = books.filter((b) => b.title.toLowerCase() === clean.toLowerCase());
  if (!r.length) r = books.filter((b) => new RegExp(escRx(clean), 'i').test(b.title)).slice(0, 5);
  if (!r.length) r = books.filter((b) => new RegExp(escRx(clean.replace(/^(the|a|an)\s+/i, '')), 'i').test(b.title)).slice(0, 5);
  if (!r.length) {
    const words = clean.toLowerCase().split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
    r = books
      .map((b) => [b, words.filter((w) => `${b.title} ${b.authorName} ${b.description}`.toLowerCase().includes(w)).length])
      .filter(([, s]) => s)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([b]) => b);
  }
  return r;
}

exports.query = asyncHandler(async (req, res) => {
  const user = req.user;
  const message = String(req.body.message || '').trim().slice(0, 300);
  const lower = message.toLowerCase();
  const reply = (p) => res.json({ success: true, data: { query: message, ...p } });
  const staff = L.isStaff(user);
  const s = await L.getSettings();

  if (!message || /^(hi|hello|hey|help|szia|what can you do|\?)\b/i.test(lower)) {
    return reply({
      intent: 'help',
      reply: "Hi! I'm your SmartLib assistant. I can locate books on the shelf, search by price, author, category, floor or language, list overdue books, show popular titles and summarise library statistics.",
      suggestions: ['Where is The Alchemist?', 'Show science books under ₹500', 'Find available books by Chetan Bhagat', 'Which books are overdue?', 'Show books available on Floor 2', 'Most popular books'],
    });
  }

  const loc = message.match(/(?:where\s+is|where's|where\s+can\s+i\s+find|locate|location\s+of|which\s+shelf\s+(?:is|has)|find\s+the\s+book|hol\s+van)\s+(.+)/i);
  if (loc) {
    const books = await titleSearch(loc[1]);
    if (!books.length) return reply({ intent: 'location', reply: `I couldn't find a book matching "${loc[1].replace(/[?]/g, '')}". Try the exact title or search by author.`, books: [] });
    const b = books[0];
    let status;
    if (b.availableCopies > 0) status = `is available (${b.availableCopies} of ${b.quantity} copies) on`;
    else {
      const [[next]] = await pool.query(`SELECT due_date FROM loans WHERE book_id = ? AND status IN ('Issued','Overdue') ORDER BY due_date LIMIT 1`, [b._id]);
      status = `is currently ${b.status.toLowerCase()}${next ? ` (next expected back ${new Date(next.due_date).toDateString()})` : ''}. Its shelf location is`;
    }
    return reply({ intent: 'location', reply: `${b.title} ${status} ${locationText(b.location)}.`, location: b.location, books: books.map(aiBook) });
  }

  if (/\boverdue\b|\blate\b.*\bbooks?\b/.test(lower)) {
    const own = !staff || /\bmy\b/.test(lower);
    const [rows] = await pool.query(`${L.LOAN_SQL} WHERE l.status = 'Overdue' ${own ? 'AND l.member_id = ?' : ''} ORDER BY l.due_date LIMIT 20`, own ? [user.memberId || -1] : []);
    const list = rows.map((i) => {
      const d = L.daysBetween(i.due_date, new Date());
      return { ...L.issueOut(i), daysOverdue: d, fine: d * s.finePerDay };
    });
    const total = list.reduce((t, r) => t + r.fine, 0);
    return reply({
      intent: 'overdue',
      reply: list.length ? `${list.length} book${list.length > 1 ? 's are' : ' is'} overdue, with ${L.money(total)} in fines accruing at ${L.money(s.finePerDay)}/day.` : 'Great news — there are no overdue books right now.',
      issues: list,
    });
  }

  if (/\bmy\s+(books|loans|issued)\b/.test(lower) && user.memberId) {
    const [rows] = await pool.query(`${L.LOAN_SQL} WHERE l.member_id = ? AND l.status IN ('Issued','Overdue') ORDER BY l.due_date`, [user.memberId]);
    return reply({
      intent: 'my-books',
      reply: rows.length ? `You have ${rows.length} book(s) issued. The next one is due on ${new Date(rows[0].due_date).toDateString()}.` : "You don't have any books issued right now.",
      issues: rows.map(L.issueOut),
    });
  }

  if (/\b(my\s+)?(fines?|dues|penalt)/.test(lower) && (/\bmy\b/.test(lower) || !staff)) {
    if (!user.memberId) return reply({ intent: 'fines', reply: 'Your account is not linked to a membership.', fines: [] });
    const [fines] = await pool.query(`${L.FINE_SQL} WHERE f.member_id = ? AND f.status IN ('Pending','Partially Paid')`, [user.memberId]);
    const due = fines.reduce((t, f) => t + L.fineRemaining(f), 0);
    return reply({ intent: 'fines', reply: due > 0 ? `You have ${L.money(due)} in pending fines across ${fines.length} charge(s).` : 'You have no pending fines. 🎉', fines: fines.map(L.fineOut) });
  }

  if (/\b(pending|outstanding|total)\s+fines?\b|\bfines?\s+(collected|pending|outstanding)/.test(lower) && staff) {
    const [[a]] = await pool.query('SELECT COALESCE(SUM(original_amount),0) t, COALESCE(SUM(discount),0) d, COALESCE(SUM(paid_amount),0) p, COALESCE(SUM(waived_amount),0) w FROM fines');
    return reply({ intent: 'stats', reply: `Fines generated: ${L.money(a.t)}. Collected: ${L.money(a.p)}. Waived/discounted: ${L.money(a.w + a.d)}. Outstanding: ${L.money(a.t - a.p - a.w - a.d)}.` });
  }

  if (/\bhow many\b|\bstatistic|\bstats\b|\bsummary\b|\btotal books\b/.test(lower) && !/\bby\b/.test(lower)) {
    const [[b]] = await pool.query('SELECT COALESCE(SUM(quantity),0) q, COUNT(*) t, COALESCE(SUM(available_copies),0) a, COALESCE(SUM(issued_copies),0) i FROM books');
    const [[m]] = await pool.query(`SELECT SUM(status = 'Active') a FROM members`);
    const [[o]] = await pool.query(`SELECT COUNT(*) n FROM loans WHERE status = 'Overdue'`);
    return reply({ intent: 'stats', reply: `The library has ${b.q} books (${b.t} titles): ${b.a} available and ${b.i} issued. ${m.a || 0} active members, ${o.n} overdue loans.` });
  }

  if (/\b(popular|most borrowed|trending|best|top)\b/.test(lower)) {
    const { rows } = await searchBooks({ limit: 8 }, { orderBy: 'b.times_borrowed DESC' });
    return reply({ intent: 'books', reply: `Here are the ${rows.length} most borrowed books in the library.`, books: rows.map((r) => aiBook(L.bookOut(r))), filters: { sort: 'popular' } });
  }
  if (/\b(new|latest|recent(ly)?)\b.*\b(books?|arrivals?|added)\b|\bnew arrivals\b/.test(lower)) {
    const { rows } = await searchBooks({ limit: 8 }, { orderBy: 'b.created_at DESC' });
    return reply({ intent: 'books', reply: 'These are the most recently added books.', books: rows.map((r) => aiBook(L.bookOut(r))), filters: { sort: 'newest' } });
  }
  if (/\brecommend|suggest/.test(lower)) {
    const { rows } = await searchBooks({ status: 'available', limit: 6 }, { orderBy: 'b.times_borrowed DESC' });
    return reply({ intent: 'books', reply: 'Based on what readers love right now, I recommend these (all available today):', books: rows.map((r) => aiBook(L.bookOut(r))) });
  }

  const { q, understood } = await parseQuery(message);
  if (!understood.length) {
    return reply({
      intent: 'unknown',
      reply: "I'm not sure what you're looking for. Try asking where a book is, or search by author, category, price or floor.",
      suggestions: ['Where is Wings of Fire?', 'Programming books under ₹800', 'Books by R.K. Narayan', 'Books on Floor 3'],
    });
  }
  const { rows, pagination } = await searchBooks({ ...q, limit: 12 }, { orderBy: 'b.available_copies DESC, b.times_borrowed DESC' });
  const total = pagination.total;
  return reply({
    intent: 'books',
    reply: total ? `I found ${total} book${total > 1 ? 's' : ''} matching ${understood.join(', ')}.${total > rows.length ? ` Showing the top ${rows.length}.` : ''}` : `No books match ${understood.join(', ')}. Try widening your search.`,
    books: rows.map((r) => aiBook(L.bookOut(r))),
    filters: q,
    total,
  });
});
