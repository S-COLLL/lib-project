import {
  initPage, api, h, inr, num, icon, badge, avatar, fmtDate, relTime, animateCounter, isStaff, bookCover, errorState,
  emptyState, occupancyClass, skeletonCards, toastError, LOCALE,
} from './app.js';
import { openIssueModal, openBookForm, dueLabel } from './shared.js';
import { ensureChart, makeChart, palette, axis, xAxis, onThemeChange } from './charts.js';

const user = await initPage('dashboard');
const staff = isStaff(user);

const greet = () => {
  const hr = new Date().getHours();
  return hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
};

const $ = (id) => document.getElementById(id);
$('greeting').textContent = `${greet()}, ${user.name.split(' ')[0]}`;
$('today').textContent = new Date().toLocaleDateString(LOCALE, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
$('heroActions').innerHTML = staff
  ? `<button class="btn btn-gold" id="qaAdd">${icon('plus')}Add book</button>
     <button class="btn" id="qaIssue">${icon('bookOpen')}Issue book</button>
     <a class="btn" href="returns.html">${icon('undo')}Return book</a>
     <a class="btn" href="ai-assistant.html">${icon('sparkles')}Ask AI</a>`
  : `<a class="btn btn-gold" href="books.html">${icon('search')}Browse books</a><a class="btn" href="ai-assistant.html">${icon('sparkles')}Ask AI</a><a class="btn" href="issues.html">${icon('bookOpen')}My loans</a>`;
$('qaAdd')?.addEventListener('click', () => openBookForm({ onSaved: load }));
$('qaIssue')?.addEventListener('click', () => openIssueModal({ onDone: load }));

$('stats').innerHTML = skeletonCards(10, 110);

const STATS = [
  ['totalBooks', 'Total Books', 'books', 'tone-navy', (s) => `${num(s.titles)} titles in catalogue`],
  ['availableBooks', 'Available Books', 'checkCircle', 'tone-teal', (s) => `${s.totalBooks ? Math.round((s.availableBooks / s.totalBooks) * 100) : 0}% of collection on shelf`],
  ['issuedBooks', 'Issued Books', 'bookOpen', 'tone-blue', () => 'Currently with members'],
  ['reservedBooks', 'Reserved Books', 'bookmark', 'tone-gold', (s) => `${s.waitingReservations} waiting in queue`],
  ['overdueBooks', 'Overdue Books', 'alert', 'tone-red', (s) => `${inr(s.accruingFines)} fines accruing`],
  ['totalMembers', 'Total Members', 'users', 'tone-purple', () => 'Registered library members'],
  ['activeMembers', 'Active Members', 'user', 'tone-teal', (s) => `${s.totalMembers - s.activeMembers} expired or suspended`],
  ['totalFines', 'Total Fines', 'rupee', 'tone-orange', (s) => `${inr(s.finesOutstanding)} outstanding`, true],
  ['totalCollected', 'Money Collected', 'wallet', 'tone-green featured', () => 'Fines & membership fees', true],
  ['booksAddedRecently', 'Books Added Recently', 'plus', 'tone-navy', () => 'In the last 30 days'],
];

let dashData = null;

async function load() {
  try {
    const { data } = await api.get('/reports/dashboard');
    dashData = data;
    renderStats(data.stats);
    await renderCharts(data.charts);
    renderShelves(data.charts.shelves);
    renderLists(data);
  } catch (e) {
    $('stats').innerHTML = `<div style="grid-column:1/-1">${errorState(e.message)}</div>`;
  }
}

function renderStats(s) {
  $('stats').innerHTML = STATS.map(
    ([k, label, ic, tone, foot], i) => `<div class="card stat-card reveal ${tone}" style="--i:${i}">
      <div class="stat-top"><span class="stat-label">${label}</span><span class="stat-icon">${icon(ic)}</span></div>
      <div class="stat-value" data-count="${s[k]}" data-money="${STATS[i][5] ? 1 : ''}">0</div><div class="stat-foot">${h(foot(s))}</div></div>`
  ).join('');
  $('stats').querySelectorAll('[data-count]').forEach((el) => animateCounter(el, Number(el.dataset.count), { format: el.dataset.money ? (v) => inr(v) : num }));
}

async function renderCharts(c) {
  const Chart = await ensureChart();
  const p = palette();

  // Books issued vs returned (line)
  makeChart($('issuedChart'), {
    type: 'line',
    data: {
      labels: c.months,
      datasets: [
        { label: 'Issued', data: c.issued, borderColor: p.c1, backgroundColor: `${p.c1}22`, fill: true, tension: 0.35, borderWidth: 2, pointRadius: 4, pointHoverRadius: 6, pointBackgroundColor: p.c1, pointBorderColor: p.card, pointBorderWidth: 2 },
        { label: 'Returned', data: c.returned, borderColor: p.c2, backgroundColor: 'transparent', tension: 0.35, borderWidth: 2, pointRadius: 4, pointHoverRadius: 6, pointBackgroundColor: p.c2, pointBorderColor: p.card, pointBorderWidth: 2, borderDash: [5, 4] },
      ],
    },
    options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, scales: { y: axis(p), x: xAxis(p) } },
  });

  // Monthly fines: generated vs collected (grouped bars)
  makeChart($('fineChart'), {
    type: 'bar',
    data: {
      labels: c.months,
      datasets: [
        { label: 'Fines generated', data: c.fines, backgroundColor: p.c3, borderRadius: 4, borderSkipped: 'bottom', maxBarThickness: 22 },
        { label: 'Money collected', data: c.collected, backgroundColor: p.c1, borderRadius: 4, borderSkipped: 'bottom', maxBarThickness: 22 },
      ],
    },
    options: {
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: { tooltip: { callbacks: { label: (ctx) => ` ${ctx.dataset.label}: ${inr(ctx.parsed.y)}` } } },
      scales: { y: axis(p, { money: true }), x: xAxis(p) },
      datasets: { bar: { categoryPercentage: 0.7, barPercentage: 0.9 } },
    },
  });

  // Popular books (horizontal, single hue)
  makeChart($('popularChart'), {
    type: 'bar',
    data: {
      labels: c.popular.map((b) => (b.label.length > 24 ? `${b.label.slice(0, 23)}…` : b.label)),
      datasets: [{ label: 'Times borrowed', data: c.popular.map((b) => b.value), backgroundColor: p.c1, borderRadius: 4, maxBarThickness: 16 }],
    },
    options: {
      indexAxis: 'y',
      maintainAspectRatio: false,
      plugins: { tooltip: { callbacks: { title: (items) => c.popular[items[0].dataIndex].label, afterTitle: (items) => c.popular[items[0].dataIndex].author } } },
      scales: { x: axis(p), y: { grid: { display: false }, border: { display: false } } },
      onClick: (_e, els) => els[0] && (location.href = `book-details.html?id=${c.popular[els[0].index].id}`),
    },
  });

  // Category distribution (horizontal bars — too many categories for a pie)
  makeChart($('categoryChart'), {
    type: 'bar',
    data: {
      labels: c.categories.map((x) => x.label),
      datasets: [{ label: 'Copies', data: c.categories.map((x) => x.value), backgroundColor: p.c2, borderRadius: 4, maxBarThickness: 14 }],
    },
    options: {
      indexAxis: 'y',
      maintainAspectRatio: false,
      plugins: { tooltip: { callbacks: { label: (ctx) => ` ${ctx.parsed.x} copies · ${c.categories[ctx.dataIndex].titles} titles` } } },
      scales: { x: axis(p), y: { grid: { display: false }, border: { display: false }, ticks: { autoSkip: false } } },
      onClick: (_e, els) => els[0] && (location.href = `books.html?category=${encodeURIComponent(c.categories[els[0].index].label)}`),
    },
  });
  return Chart;
}

function renderShelves(shelves) {
  $('shelfBars').innerHTML = shelves
    .map(
      (s, i) => `<a class="shelf-bar ${occupancyClass(s.percent)} reveal" style="--i:${i};color:inherit;text-decoration:none" href="shelves.html?shelf=SH-${s.code}" title="${h(s.section)} · Floor ${s.floor}">
      <div class="sb-top"><strong>${h(s.label)} <span class="muted small" style="font-weight:400;color:var(--text-2)">· F${s.floor} ${h(s.section)}</span></strong><span>${s.percent}%</span></div>
      <div class="progress"><span style="width:0" data-w="${Math.min(100, s.percent)}"></span></div>
      <div class="small muted" style="margin-top:3px">${s.occupied} / ${s.capacity} slots</div></a>`
    )
    .join('');
  requestAnimationFrame(() => $('shelfBars').querySelectorAll('[data-w]').forEach((el) => (el.style.width = `${el.dataset.w}%`)));
}

function renderLists(d) {
  $('recentTx').innerHTML = d.recentTransactions.length
    ? d.recentTransactions
        .map(
          (t, i) => `<tr style="--i:${i}"><td><span class="mono">${t.transactionId}</span></td><td><div class="t-title">${h(t.bookTitle)}</div><div class="t-sub">${h(t.bookCode)}</div></td>
          <td>${h(t.memberName)}<div class="t-sub">${h(t.memberCode)}</div></td><td class="nowrap">${fmtDate(t.issueDate)}</td><td class="nowrap">${dueLabel(t)}</td><td>${badge(t.status)}</td></tr>`
        )
        .join('')
    : `<tr><td colspan="6">${emptyState('No transactions yet')}</td></tr>`;

  $('overdueList').innerHTML = d.overdue.length
    ? d.overdue
        .map(
          (o) => `<div class="list-item overdue-item">${bookCover(o.book || { title: o.bookTitle }, 'cover-xs')}
          <div class="li-main"><div class="li-title">${h(o.bookTitle)}</div><div class="li-sub">${h(o.memberName)} · due ${fmtDate(o.dueDate)}</div></div>
          <div class="days">${o.daysOverdue}d<div class="small" style="font-weight:500;color:var(--text-2)">${inr(o.fine)}</div></div></div>`
        )
        .join('')
    : emptyState('No overdue books', 'Every loan is within its due date.', 'checkCircle');

  $('recentMembers').innerHTML = d.recentMembers.length
    ? d.recentMembers
        .map(
          (m) => `<a class="list-item" href="${staff ? `members.html?id=${m.memberId}` : '#'}" style="color:inherit;text-decoration:none">${avatar(m.name, m.profilePhoto)}
          <div class="li-main"><div class="li-title">${h(m.name)}</div><div class="li-sub">${m.memberId} · ${h(m.department || m.membershipType)}</div></div>
          <div style="text-align:right">${badge(m.status)}<div class="small muted">${relTime(m.createdAt)}</div></div></a>`
        )
        .join('')
    : emptyState('No members yet');

  $('recentBooks').innerHTML = d.recentBooks
    .map(
      (b) => `<a class="list-item" href="book-details.html?id=${b.bookId}" style="color:inherit;text-decoration:none">${bookCover(b, 'cover-xs')}
      <div class="li-main"><div class="li-title">${h(b.title)}</div><div class="li-sub">${h(b.authorName)} · ${h(b.categoryName)}</div></div><span class="small muted nowrap">${relTime(b.createdAt)}</span></a>`
    )
    .join('');
}

async function loadRecommendations() {
  const box = $('recs');
  box.innerHTML = Array.from({ length: 6 }, () => '<div class="skeleton" style="height:300px;border-radius:14px"></div>').join('');
  try {
    const { data, basedOn } = await api.get('/books/recommendations', { limit: 10 });
    $('recBasis').textContent = basedOn.borrowed
      ? `Based on ${basedOn.borrowed} borrowed book${basedOn.borrowed > 1 ? 's' : ''}${basedOn.searches.length ? ` and searches like “${basedOn.searches[0]}”` : ''}, plus what's popular`
      : basedOn.searches.length
        ? `Based on your searches and popular titles`
        : 'Popular and trending titles across the library';
    box.innerHTML = data
      .map(
        (b, i) => `<a class="rec-card reveal" style="--i:${i}" href="book-details.html?id=${b.bookId}">${bookCover(b, 'cover-md')}
        <span class="rec-reason">${icon('sparkles')}${h(b.reason)}</span>
        <div><div class="rc-title">${h(b.title)}</div><div class="small muted">${h(b.authorName)}</div></div>
        <div class="row-between"><span class="amount">${inr(b.price)}</span>${badge(b.availableCopies > 0 ? 'Available' : b.status)}</div></a>`
      )
      .join('');
  } catch (e) {
    box.innerHTML = errorState(e.message);
  }
}

async function loadMyLoans() {
  if (staff || !user.member) return;
  $('myLoansCard').classList.remove('hidden');
  try {
    const { data } = await api.get('/issues', { status: 'Active', limit: 10 });
    $('myLoans').innerHTML = data.length
      ? data
          .map(
            (t) => `<div class="list-item">${bookCover(t.book || { title: t.bookTitle }, 'cover-xs')}<div class="li-main"><div class="li-title">${h(t.bookTitle)}</div><div class="li-sub">Issued ${fmtDate(t.issueDate)} · ${t.transactionId}</div></div>
            <div style="text-align:right" class="small">${dueLabel(t)}</div></div>`
          )
          .join('')
      : emptyState('No books issued', 'Browse the catalogue to find your next read.', 'book');
  } catch (e) {
    toastError(e);
  }
}

await load();
loadRecommendations();
loadMyLoans();
onThemeChange(() => dashData && renderCharts(dashData.charts));
