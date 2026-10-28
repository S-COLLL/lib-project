import { initPage, api, h, inr, icon, avatar, bookCover, badge, qp, fmtDate } from './app.js';
import { openShelfRoute, bookStatus } from './shared.js';

const user = await initPage('ai');
const $ = (id) => document.getElementById(id);
$('orb').innerHTML = icon('bot');
$('sendBtn').innerHTML = `${icon('send')}<span class="hide-sm">Ask</span>`;

const SUGGESTIONS = [
  'Where is The Alchemist?',
  'Show science books under ₹500',
  'Find available books by Chetan Bhagat',
  'Which books are overdue?',
  'Show books available on Floor 2',
  'Most popular books',
  'Hindi books',
  'Programming books between ₹300 and ₹900',
  'New arrivals',
  'How many books are available?',
];
$('suggest').innerHTML = SUGGESTIONS.map((s) => `<button class="chip" type="button">${icon('sparkles')}${h(s)}</button>`).join('');
$('suggest').addEventListener('click', (e) => {
  const c = e.target.closest('.chip');
  if (c) send(c.textContent.trim());
});

const chat = $('chat');
const scroll = () => chat.scrollTo({ top: chat.scrollHeight, behavior: 'smooth' });
const booksCache = new Map();

function addUser(text) {
  chat.insertAdjacentHTML('beforeend', `<div class="msg user"><div class="who">${avatar(user.name, user.avatar, 'avatar-sm')}</div><div class="bubble">${h(text)}</div></div>`);
  scroll();
}

function addTyping() {
  const el = document.createElement('div');
  el.className = 'msg ai';
  el.innerHTML = `<div class="who">${icon('bot')}</div><div class="bubble"><span class="typing"><i></i><i></i><i></i></span></div>`;
  chat.appendChild(el);
  scroll();
  return el;
}

// Type text out character by character (subtle typing animation)
function typeInto(el, text) {
  return new Promise((resolve) => {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      el.textContent = text;
      return resolve();
    }
    el.classList.add('caret');
    let i = 0;
    const step = Math.max(1, Math.round(text.length / 90));
    const tick = () => {
      i = Math.min(text.length, i + step);
      el.textContent = text.slice(0, i);
      if (i < text.length) setTimeout(tick, 14);
      else {
        el.classList.remove('caret');
        resolve();
      }
    };
    tick();
  });
}

const locText = (l) => (l?.shelfCode ? `Floor ${l.floor} · ${l.section} · Shelf ${l.shelfCode} · Rack ${l.rack} · Row ${l.row} · Pos ${l.position}` : '');

function extras(d) {
  let html = '';
  if (d.intent === 'location' && d.books?.length) {
    const b = d.books[0];
    const l = b.location;
    html += `<div class="ai-loc"><div class="al-title">📚 ${h(b.title)}</div>
      <div class="al-path">${[`📍 Floor ${l.floor}`, `${l.section} Section`, `Shelf ${l.shelfCode}`, `Rack ${l.rack}`, `Row ${l.row}`, `Position ${l.position}`].map((x) => `<span>${h(x)}</span>`).join('<span style="border:0;background:none;padding:0">→</span>')}</div></div>
      <div class="ai-actions"><button class="btn btn-sm btn-primary" data-route="${b.bookId}">${icon('navigation')}Show route to shelf</button><a class="btn btn-sm" href="book-details.html?id=${b.bookId}">${icon('eye')}Book details</a></div>`;
    if (d.books.length > 1) html += `<div class="small muted" style="margin-top:10px">Other matches:</div>${bookGrid(d.books.slice(1))}`;
  } else if (d.books?.length) {
    html += bookGrid(d.books);
    if (d.filters) {
      const p = new URLSearchParams();
      Object.entries(d.filters).forEach(([k, v]) => {
        if (['search', 'category', 'status', 'language', 'floor', 'sort'].includes(k)) p.set(k, v);
      });
      if (d.filters.shelf) p.set('search', `shelf ${d.filters.shelf}`);
      html += `<div class="ai-actions"><a class="btn btn-sm" href="books.html?${p}">${icon('filter')}Open in catalogue</a></div>`;
    }
  }
  if (d.issues?.length) {
    html += `<div class="list" style="margin-top:10px">${d.issues
      .slice(0, 10)
      .map((i) => `<div class="list-item"><div class="li-main"><div class="li-title">${h(i.bookTitle)}</div><div class="li-sub">${h(i.memberName)} · ${i.transactionId} · due ${fmtDate(i.dueDate)}</div></div>${i.daysOverdue ? `<span class="badge badge-overdue">${i.daysOverdue}d · ${inr(i.fine)}</span>` : badge(i.status)}</div>`)
      .join('')}</div>`;
  }
  if (d.fines?.length) html += `<div class="ai-actions"><a class="btn btn-sm" href="fines.html">${icon('rupee')}View my fines</a></div>`;
  if (d.suggestions?.length) html += `<div class="ai-actions">${d.suggestions.map((s) => `<button class="chip" data-ask="${h(s)}">${h(s)}</button>`).join('')}</div>`;
  return html;
}

function bookGrid(books) {
  books.forEach((b) => booksCache.set(b.bookId, b));
  return `<div class="ai-results">${books
    .map(
      (b, i) => `<a class="ai-book" style="--i:${i}" href="book-details.html?id=${b.bookId}">${bookCover(b, 'cover-sm')}<div style="min-width:0"><div class="ab-title">${h(b.title)}</div>
      <div class="small muted">${h(b.authorName)} · ${inr(b.price)}</div><div class="ab-loc">📍 ${h(locText(b.location))}</div><div style="margin-top:4px">${badge(bookStatus(b))}</div></div></a>`
    )
    .join('')}</div>`;
}

let busy = false;
async function send(text) {
  const q = String(text || '').trim();
  if (!q || busy) return;
  busy = true;
  $('ask').value = '';
  addUser(q);
  const typing = addTyping();
  const started = Date.now();
  try {
    const { data } = await api.post('/ai/query', { message: q });
    await new Promise((r) => setTimeout(r, Math.max(0, 450 - (Date.now() - started))));
    const bubble = typing.querySelector('.bubble');
    bubble.innerHTML = '<div class="ai-text"></div>';
    await typeInto(bubble.querySelector('.ai-text'), data.reply);
    bubble.insertAdjacentHTML('beforeend', extras(data));
    if (data.books) data.books.forEach((b) => booksCache.set(b.bookId, b));
  } catch (e) {
    typing.querySelector('.bubble').innerHTML = `<span class="text-error">${h(e.message)}</span>`;
  } finally {
    busy = false;
    scroll();
    $('ask').focus();
  }
}

chat.addEventListener('click', (e) => {
  const r = e.target.closest('[data-route]');
  if (r) openShelfRoute(booksCache.get(r.dataset.route));
  const a = e.target.closest('[data-ask]');
  if (a) send(a.dataset.ask);
});

$('askForm').addEventListener('submit', (e) => {
  e.preventDefault();
  send($('ask').value);
});

// Welcome message
const welcome = document.createElement('div');
welcome.className = 'msg ai';
welcome.innerHTML = `<div class="who">${icon('bot')}</div><div class="bubble"><div class="ai-text"></div></div>`;
chat.appendChild(welcome);
await typeInto(welcome.querySelector('.ai-text'), `Hello ${user.name.split(' ')[0]}! I can find the exact shelf location of any book, search by price, author, category, floor or language, and list overdue loans. What are you looking for?`);
if (qp('q')) send(qp('q'));
