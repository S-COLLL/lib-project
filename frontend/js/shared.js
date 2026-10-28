// Components shared across pages: book location, shelf route, QR codes,
// issue / reserve / payment / receipt modals and the book form.
import {
  api, h, inr, fmtDate, isoDate, icon, badge, avatar, toast, toastError, openModal, loadScript, LIBS, debounce,
  bookCover, validateForm, formData, applyServerErrors, withLoading, isStaff, printModal, imageToDataUrl, occupancyClass,
  fmtDateTime, daysUntil, session,
} from './app.js';

/* ================================ Status ================================ */

export function bookStatus(b) {
  if (b.availableCopies > 0) return 'Available';
  if (b.hasOverdue) return 'Overdue';
  return b.status || 'Unavailable';
}

/* =============================== Location =============================== */

const sectionLabel = (s = '') => (/section$/i.test(s) ? s : `${s}`);

export function locationCard(book, { actions = true } = {}) {
  const l = book.location || {};
  if (!l.shelfCode) return `<div class="callout warn">${icon('alert')}<span>No shelf location assigned.</span></div>`;
  const steps = [
    ['Floor', `Floor ${l.floor}`],
    ['Section', sectionLabel(l.section)],
    ['Shelf', `Shelf ${l.shelfCode}`],
    ['Rack', `Rack ${l.rack}`],
    ['Row', `Row ${l.row}`],
    ['Position', `Position ${l.position}`],
  ];
  return `<div class="location-card">
    <div class="row-between wrap"><div class="lc-head">${icon('mapPin')} Book location</div>
      ${actions ? `<button class="btn btn-primary btn-sm" data-find-shelf>${icon('search')}Find book on shelf</button>` : ''}</div>
    <div class="location-path">${steps.map(([k, v], i) => `<div class="loc-step" style="--i:${i}"><small>${k}</small><strong title="${h(v)}">${h(v)}</strong></div>`).join('')}</div>
  </div>`;
}

/** Animated route from the entrance to the exact rack/row/position. */
export async function openShelfRoute(book) {
  const l = book.location || {};
  const m = openModal({
    title: `Find “${book.title}”`,
    subtitle: `Floor ${l.floor} → ${h(l.section)} → Shelf ${h(l.shelfCode)} → Rack ${h(l.rack)} → Row ${h(l.row)} → Position ${h(l.position)}`,
    size: 'modal-lg',
    body: '<div class="skeleton" style="height:360px"></div>',
    footer: `<a class="btn" href="shelves.html?shelf=SH-${h(l.shelfCode)}">${icon('shelf')}Open shelf map</a><button class="btn btn-primary" data-close>Got it</button>`,
  });
  try {
    const { data: shelves } = await api.get('/shelves', { floor: l.floor });
    m.body.innerHTML = routeMarkup(book, shelves);
    requestAnimationFrame(() => m.body.querySelector('.route-path')?.classList.add('draw'));
  } catch (e) {
    m.body.innerHTML = `<div class="callout error">${icon('alert')}${h(e.message)}</div>`;
  }
}

function routeMarkup(book, shelves) {
  const l = book.location;
  const sections = [];
  shelves.forEach((s) => {
    let sec = sections.find((x) => x.name === s.section);
    if (!sec) sections.push((sec = { name: s.section, shelves: [] }));
    sec.shelves.push(s);
  });
  const W = 640;
  const cols = Math.min(3, sections.length) || 1;
  const rows = Math.ceil(sections.length / cols) || 1;
  const left = 60;
  const top = 34;
  const areaW = W - left - 24;
  const gapX = 22;
  const gapY = 44;
  const secW = (areaW - (cols - 1) * gapX) / cols;
  const secH = Math.min(120, (250 - (rows - 1) * gapY) / rows);
  const H = top + rows * secH + (rows - 1) * gapY + 90;
  let target = null;
  const blocks = sections
    .map((sec, i) => {
      const c = i % cols;
      const r = Math.floor(i / cols);
      const x = left + c * (secW + gapX);
      const y = top + r * (secH + gapY);
      const n = sec.shelves.length;
      const sw = Math.min(46, (secW - 24 - (n - 1) * 10) / n);
      const startX = x + (secW - (n * sw + (n - 1) * 10)) / 2;
      const isSec = sec.name === l.section;
      const shelfRects = sec.shelves
        .map((s, j) => {
          const sx = startX + j * (sw + 10);
          const sy = y + 30;
          const sh = secH - 42;
          const hit = s.code === l.shelfCode;
          if (hit) target = { x: sx + sw / 2, y: sy + sh, corridor: y + secH + gapY / 2, sx, sy, sw, sh };
          return `<g class="${hit ? 'route-target' : ''}"><rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" rx="5" class="route-shelf ${occupancyClass(s.occupancyPercent)}"/>
            <text x="${sx + sw / 2}" y="${sy + sh / 2 + 4}" text-anchor="middle" class="route-shelf-label">${h(s.code)}</text></g>`;
        })
        .join('');
      return `<g><rect x="${x}" y="${y}" width="${secW}" height="${secH}" rx="12" class="route-section ${isSec ? 'is-target' : ''}"/>
        <text x="${x + 12}" y="${y + 19}" class="route-section-label">${h(sec.name.toUpperCase())}</text>${shelfRects}</g>`;
    })
    .join('');
  const entrance = { x: 30, y: H - 22 };
  let path = '';
  if (target) {
    const cy = Math.min(target.corridor, H - 50);
    path = `M ${entrance.x} ${entrance.y} L ${entrance.x} ${cy} L ${target.x} ${cy} L ${target.x} ${target.y + 4}`;
  }
  // Rack diagram
  const shelf = shelves.find((s) => s.code === l.shelfCode) || { racks: 4, rowsPerRack: 4 };
  const rackNo = Number(l.rack);
  const rowIdx = l.row.charCodeAt(0) - 65;
  const rackCells = Array.from({ length: shelf.racks }, (_, r) =>
    `<div class="rack ${r + 1 === rackNo ? 'is-target' : ''}"><div class="rack-label">Rack ${String(r + 1).padStart(2, '0')}</div>
      ${Array.from({ length: shelf.rowsPerRack }, (_, k) => `<div class="rack-row ${r + 1 === rackNo && k === rowIdx ? 'hit' : ''}"><span>${String.fromCharCode(65 + k)}</span>${r + 1 === rackNo && k === rowIdx ? `<b class="pos-pin">${h(l.position)}</b>` : ''}</div>`).join('')}</div>`
  ).join('');

  const steps = [
    ['door', 'Enter the library', 'Main entrance'],
    ['layers', `Go to Floor ${l.floor}`, 'Use the stairs or lift'],
    ['navigation', `${l.section} Section`, 'Follow the highlighted aisle'],
    ['shelf', `Shelf ${l.shelfCode}`, `${shelf.racks} racks · look for the gold label`],
    ['grid', `Rack ${l.rack} · Row ${l.row}`, 'Count racks from the left'],
    ['mapPin', `Position ${l.position}`, book.availableCopies > 0 ? `${book.availableCopies} cop${book.availableCopies > 1 ? 'ies' : 'y'} on shelf` : 'Currently not on shelf'],
  ];
  return `<div class="route-grid">
    <div>
      <svg class="route-map" viewBox="0 0 ${W} ${H}" role="img" aria-label="Floor ${l.floor} map with route to Shelf ${h(l.shelfCode)}">
        <text x="${W - 20}" y="20" text-anchor="end" class="route-floor">FLOOR ${l.floor}</text>
        <line x1="${entrance.x}" y1="${top - 10}" x2="${entrance.x}" y2="${H - 10}" class="route-aisle"/>
        ${blocks}
        ${path ? `<path d="${path}" class="route-path"/><circle r="6" class="route-walker"><animateMotion dur="2.2s" fill="freeze" path="${path}" keySplines="0.22 1 0.36 1" calcMode="spline" keyTimes="0;1"/></circle>` : ''}
        <g><rect x="${entrance.x - 22}" y="${H - 16}" width="44" height="12" rx="4" class="route-entrance"/><text x="${entrance.x}" y="${H - 22}" text-anchor="middle" class="route-entrance-label">ENTRANCE</text></g>
      </svg>
      <div class="rack-diagram"><div class="rd-title">${icon('shelf')} Shelf ${h(l.shelfCode)} — front view</div><div class="racks">${rackCells}</div></div>
    </div>
    <ol class="route-steps">${steps.map(([ic, t, s], i) => `<li style="--i:${i}"><span class="rs-icon">${icon(ic)}</span><div><strong>${h(t)}</strong><small>${h(s)}</small></div></li>`).join('')}</ol>
  </div>`;
}

export function bindFindShelf(root, book) {
  root.querySelectorAll('[data-find-shelf]').forEach((b) => b.addEventListener('click', () => openShelfRoute(book)));
}

/* ================================== QR ================================== */

const appUrl = (path) => new URL(path, location.href).href;

export async function renderQr(el, text, size = 150) {
  await loadScript(LIBS.qrcode);
  el.innerHTML = '';
  // eslint-disable-next-line no-new
  new window.QRCode(el, { text, width: size, height: size, colorDark: '#0f172a', colorLight: '#ffffff', correctLevel: window.QRCode.CorrectLevel.M });
}

export async function openBookCodes(book) {
  const url = appUrl(`book-details.html?id=${book.bookId}`);
  const m = openModal({
    title: 'Book QR & Barcode',
    subtitle: `${h(book.title)} · ${book.bookId}`,
    body: `<div class="grid grid-2" style="align-items:start">
      <div class="qr-box"><div id="bqr"></div><strong class="mono">${book.bookId}</strong><span class="small" style="color:#64748b">Scan to open book details</span></div>
      <div class="stack" style="gap:12px"><div class="barcode-box"><svg id="bbar"></svg></div>
        <div class="kv"><div><small>Book ID</small><strong class="mono">${book.bookId}</strong></div><div><small>ISBN</small><strong class="mono">${h(book.isbn)}</strong></div>
        <div><small>Location</small><strong>F${book.location?.floor} · ${h(book.location?.shelfCode)} · R${h(book.location?.rack)}-${h(book.location?.row)}${h(book.location?.position)}</strong></div></div>
        <p class="small muted" style="word-break:break-all">${h(url)}</p></div></div>`,
    footer: `<button class="btn" data-print>${icon('printer')}Print label</button><button class="btn btn-primary" data-close>Done</button>`,
    size: 'modal-lg',
  });
  m.el.querySelector('[data-print]').onclick = () => printModal(m);
  try {
    await renderQr(m.el.querySelector('#bqr'), url);
    await loadScript(LIBS.barcode);
    window.JsBarcode(m.el.querySelector('#bbar'), book.isbn, { format: book.isbn.length === 13 ? 'EAN13' : 'CODE128', displayValue: true, height: 70, margin: 10, fontSize: 14 });
  } catch (e) {
    toastError(e);
  }
}

export async function openShelfQr(shelf) {
  const url = appUrl(`shelves.html?shelf=${shelf.shelfId}`);
  const m = openModal({
    title: `${shelf.name} QR code`,
    subtitle: `Floor ${shelf.floor} · ${h(shelf.section)}`,
    body: `<div class="qr-box"><div id="sqr"></div><strong class="mono">${shelf.shelfId}</strong><span class="small" style="color:#64748b">Scan to view shelf contents & capacity</span></div>`,
    footer: `<button class="btn" data-print>${icon('printer')}Print</button><button class="btn btn-primary" data-close>Done</button>`,
    size: 'modal-sm',
  });
  m.el.querySelector('[data-print]').onclick = () => printModal(m);
  renderQr(m.el.querySelector('#sqr'), url, 180).catch(toastError);
}

/* ============================ Entity pickers ============================ */

/**
 * Live search picker. type: 'member' | 'book'
 */
export function entityPicker(container, { type, placeholder, onPick, initial, filter }) {
  container.innerHTML = `<div class="picker"><div class="input-group">${icon(type === 'member' ? 'user' : 'book')}
    <input class="input" placeholder="${h(placeholder)}" autocomplete="off" aria-label="${h(placeholder)}"></div><div class="picker-results hidden"></div><div class="picker-picked"></div></div>`;
  const input = container.querySelector('input');
  const results = container.querySelector('.picker-results');
  const picked = container.querySelector('.picker-picked');
  let current = null;

  const renderItem = (x) =>
    type === 'member'
      ? `${avatar(x.name, x.profilePhoto, 'avatar-sm')}<div style="flex:1;min-width:0"><div style="font-weight:600">${h(x.name)}</div><div class="small muted">${x.memberId} · ${h(x.membershipType)} · ${x.booksIssued} issued${x.pendingFine ? ` · <span class="text-error">${inr(x.pendingFine)} due</span>` : ''}</div></div>${badge(x.status)}`
      : `${bookCover(x, 'cover-xs')}<div style="flex:1;min-width:0"><div style="font-weight:600">${h(x.title)}</div><div class="small muted">${x.bookId} · ${h(x.authorName)} · ${x.availableCopies}/${x.quantity} available</div></div>${badge(bookStatus(x))}`;

  const pick = (x) => {
    current = x;
    input.closest('.input-group').classList.add('hidden');
    results.classList.add('hidden');
    picked.innerHTML = `<div class="picked">${renderItem(x)}<button type="button" class="btn btn-ghost btn-sm" aria-label="Change">Change</button></div>`;
    picked.querySelector('button').onclick = () => {
      current = null;
      picked.innerHTML = '';
      input.closest('.input-group').classList.remove('hidden');
      input.value = '';
      input.focus();
      onPick?.(null);
    };
    onPick?.(x);
  };
  const search = debounce(async () => {
    const q = input.value.trim();
    if (q.length < 1) return results.classList.add('hidden');
    try {
      const { data } = await api.get(type === 'member' ? '/members' : '/books', { search: q, limit: 8 });
      const list = filter ? data.filter(filter) : data;
      results.classList.remove('hidden');
      results.innerHTML = list.length ? list.map((x, i) => `<div class="picker-item" data-i="${i}">${renderItem(x)}</div>`).join('') : '<div class="search-empty small">No matches</div>';
      results.querySelectorAll('.picker-item').forEach((el) => el.addEventListener('click', () => pick(list[el.dataset.i])));
    } catch (e) {
      results.innerHTML = `<div class="search-empty small">${h(e.message)}</div>`;
    }
  }, 200);
  input.addEventListener('input', search);
  if (initial) pick(initial);
  return { get value() {
    return current;
  } };
}

/* ================================ Issue ================================ */

export async function openIssueModal({ book = null, member = null, onDone } = {}) {
  const { data: settings } = await api.get('/settings').catch(() => ({ data: { loanDays: 14, finePerDay: 10 } }));
  const due = new Date(Date.now() + settings.loanDays * 86400000);
  const m = openModal({
    title: 'Issue book',
    subtitle: `Standard loan: ${settings.loanDays} days · Late fine ${inr(settings.finePerDay)}/day`,
    size: 'modal-lg',
    body: `<form id="issueForm" novalidate class="form-grid">
      <div class="field full"><label>Member <span class="req">*</span></label><div id="memberPick"></div></div>
      <div class="field full"><label>Book <span class="req">*</span></label><div id="bookPick"></div></div>
      <div class="field"><label for="issueDate">Issue date <span class="req">*</span></label><input class="input" type="date" id="issueDate" name="issueDate" required max="${isoDate()}" value="${isoDate()}"><span class="field-hint">Back-date to record a paper loan</span></div>
      <div class="field"><label for="loanDays">Loan length</label><select class="select" id="loanDays">${[...new Set([7, 14, 21, 28, settings.loanDays])].sort((a, b) => a - b).map((n) => `<option value="${n}" ${n === settings.loanDays ? 'selected' : ''}>${n} days</option>`).join('')}</select></div>
      <div class="field"><label for="dueDate">Due date <span class="req">*</span></label><input class="input" type="date" id="dueDate" name="dueDate" required min="${isoDate(new Date(Date.now() + 86400000))}" value="${isoDate(due)}"></div>
      <div class="field"><label>Issued by</label><input class="input" value="${h(session.user?.name)}" readonly></div>
      <div class="full" id="issueNote"></div>
    </form>`,
    footer: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="issueSubmit">${icon('bookOpen')}Issue book</button>`,
  });
  const note = m.el.querySelector('#issueNote');
  const updateNote = () => {
    const b = bookPick.value;
    const mem = memberPick.value;
    const msgs = [];
    if (mem && mem.status !== 'Active') msgs.push(['error', `Membership is ${mem.status}.`]);
    if (mem && mem.pendingFine > (settings.maxPendingFine ?? 500)) msgs.push(['warn', `${mem.name} has ${inr(mem.pendingFine)} pending fines (limit ${inr(settings.maxPendingFine)}).`]);
    if (mem && mem.booksIssued >= (settings.maxBooksPerMember ?? 5)) msgs.push(['warn', `${mem.name} already has ${mem.booksIssued} books (limit ${settings.maxBooksPerMember}).`]);
    if (b && b.availableCopies < 1) msgs.push(['warn', `No copies of “${b.title}” are free. It can only be issued to a member whose reservation is ready.`]);
    if (b && b.availableCopies > 0 && mem) msgs.push(['success', `Available copies will change from ${b.availableCopies} to ${b.availableCopies - 1}.`]);
    note.innerHTML = msgs.map(([t, s]) => `<div class="callout ${t}" style="margin-top:6px">${icon(t === 'success' ? 'checkCircle' : 'alert')}<span>${h(s)}</span></div>`).join('');
  };
  const issueInput = m.el.querySelector('#issueDate');
  const daysInput = m.el.querySelector('#loanDays');
  const dueInput = m.el.querySelector('#dueDate');
  const syncDue = () => {
    const start = new Date(`${issueInput.value || isoDate()}T12:00:00`);
    dueInput.value = isoDate(new Date(start.getTime() + Number(daysInput.value) * 86400000));
    dueInput.min = isoDate(new Date(start.getTime() + 86400000));
  };
  issueInput.addEventListener('change', syncDue);
  daysInput.addEventListener('change', syncDue);
  const memberPick = entityPicker(m.el.querySelector('#memberPick'), { type: 'member', placeholder: 'Search member by name, ID, Neptun code or email…', initial: member, onPick: updateNote });
  const bookPick = entityPicker(m.el.querySelector('#bookPick'), { type: 'book', placeholder: 'Search book by title, ID, ISBN…', initial: book, onPick: updateNote });
  updateNote();
  const btn = m.el.querySelector('#issueSubmit');
  btn.onclick = async () => {
    const form = m.el.querySelector('#issueForm');
    if (!memberPick.value || !bookPick.value) return toast('Select both a member and a book', 'warning');
    if (!validateForm(form)) return;
    await withLoading(btn, async () => {
      try {
        const today = issueInput.value === isoDate();
        const res = await api.post('/issues', {
          member: memberPick.value.memberId,
          book: bookPick.value.bookId,
          dueDate: dueInput.value,
          ...(today ? {} : { issueDate: `${issueInput.value}T12:00:00` }),
        });
        toast(`${res.data.transactionId}: “${res.data.bookTitle}” issued to ${res.data.memberName}. Due ${fmtDate(res.data.dueDate)}.`, 'success', 'Book issued');
        m.close();
        onDone?.(res);
      } catch (e) {
        applyServerErrors(form, e);
      }
    });
  };
  return m;
}

/* =============================== Reserve =============================== */

export function openReserveModal({ book, onDone } = {}) {
  const student = !isStaff();
  const m = openModal({
    title: 'Reserve book',
    subtitle: book ? `${h(book.title)} · ${book.availableCopies} of ${book.quantity} available` : '',
    body: `<form id="resForm" class="stack" style="gap:14px">
      ${student ? '' : '<div class="field"><label>Member <span class="req">*</span></label><div id="resMember"></div></div>'}
      ${book ? '' : '<div class="field"><label>Book <span class="req">*</span></label><div id="resBook"></div></div>'}
      <div class="callout gold">${icon('bookmark')}<span>${book && book.availableCopies > 0 ? 'A copy is free now — it will be held for pickup immediately.' : 'The member joins the waiting queue and is notified as soon as a copy is returned.'}</span></div>
    </form>`,
    footer: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="resSubmit">${icon('bookmark')}Reserve</button>`,
  });
  const mp = student ? null : entityPicker(m.el.querySelector('#resMember'), { type: 'member', placeholder: 'Search member…' });
  const bp = book ? null : entityPicker(m.el.querySelector('#resBook'), { type: 'book', placeholder: 'Search book…' });
  const btn = m.el.querySelector('#resSubmit');
  btn.onclick = () =>
    withLoading(btn, async () => {
      const b = book || bp.value;
      if (!b || (!student && !mp.value)) return toast('Select the member and the book', 'warning');
      try {
        const res = await api.post('/reservations', { book: b.bookId, member: mp?.value?.memberId });
        toast(res.message, 'success', 'Reservation created');
        m.close();
        onDone?.(res);
      } catch (e) {
        toastError(e);
      }
    });
}

/* ============================ Renew ============================ */

export async function renewIssue(issue, onDone) {
  try {
    const res = await api.patch(`/issues/${issue.transactionId}/renew`);
    toast(res.message, 'success', 'Loan renewed');
    onDone?.(res);
  } catch (e) {
    toastError(e);
  }
}

/* ============================ Payment (mock) ============================ */

const METHODS = [
  ['Cash', 'wallet', 'Collected at desk'],
  ['UPI', 'qr', 'GPay · PhonePe · Paytm'],
  ['Card', 'card', 'Debit / Credit'],
  ['Bank Transfer', 'building', 'NEFT / IMPS'],
];

/**
 * Collect a payment for a fine (fine given) or a general charge (member given).
 * Uses a simulated gateway — no real money is processed.
 */
export function openPaymentModal({ fine = null, member = null, onDone } = {}) {
  const remaining = fine ? fine.remainingAmount : 0;
  const m = openModal({
    title: fine ? 'Collect fine payment' : 'Record payment',
    subtitle: fine ? `${fine.fineId} · ${h(fine.type)} · ${h(fine.member?.name || '')}` : 'Membership fees and other charges',
    size: 'modal-lg',
    body: `<form id="payForm" novalidate class="grid grid-2" style="gap:22px;align-items:start">
      <div class="stack" style="gap:14px">
        ${fine ? '' : '<div class="field"><label>Member <span class="req">*</span></label><div id="payMember"></div></div>'}
        ${fine ? '' : `<div class="field"><label for="reason">Reason <span class="req">*</span></label><select class="select" id="reason" name="reason" required><option value="Membership Fee">Membership Fee</option><option value="Replacement Cost">Replacement Cost</option><option value="Other Charges">Other Charges</option></select></div>`}
        <div class="field"><label for="amount">Amount (₹) <span class="req">*</span></label>
          <div class="input-group"><span class="input-prefix">₹</span><input class="input with-prefix" type="number" id="amount" name="amount" min="1" ${fine ? `max="${remaining}"` : ''} step="1" required value="${fine ? remaining : 500}"></div>
          ${fine ? `<div class="field-hint">Remaining balance ${inr(remaining)} — enter less for a partial payment.</div>` : ''}</div>
        <div class="field"><label>Payment method</label><div class="method-grid">${METHODS.map(([k, ic, s], i) => `<label class="method ${i === 0 ? 'active' : ''}"><input type="radio" name="method" value="${k}" ${i === 0 ? 'checked' : ''}>${icon(ic)}<strong>${k}</strong><small>${s}</small></label>`).join('')}</div></div>
        <div class="field"><label for="notes">Notes</label><input class="input" id="notes" name="notes" placeholder="Optional"></div>
      </div>
      <div class="stack" style="gap:14px">
        ${fine ? `<div class="money-summary"><div class="ms-row"><span class="muted">Original fine</span><span class="amount">${inr(fine.originalAmount)}</span></div>
          <div class="ms-row"><span class="muted">Discount</span><span class="amount">− ${inr(fine.discount)}</span></div>
          <div class="ms-row"><span class="muted">Already paid</span><span class="amount">− ${inr(fine.paidAmount)}</span></div>
          ${fine.waivedAmount ? `<div class="ms-row"><span class="muted">Waived</span><span class="amount">− ${inr(fine.waivedAmount)}</span></div>` : ''}
          <div class="ms-row ms-total"><span>Remaining</span><span class="amount">${inr(remaining)}</span></div></div>` : ''}
        <div id="gateway" class="gateway"></div>
        <div class="callout">${icon('shield')}<span>Demo gateway — payments are simulated for this college project. No real money is charged.</span></div>
      </div>
    </form>`,
    footer: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="paySubmit">${icon('check')}<span>Confirm payment</span></button>`,
  });
  const form = m.el.querySelector('#payForm');
  const gw = m.el.querySelector('#gateway');
  const mp = fine ? null : entityPicker(m.el.querySelector('#payMember'), { type: 'member', placeholder: 'Search member…', initial: member });
  const amountEl = form.amount;
  const method = () => form.querySelector('input[name=method]:checked').value;

  const renderGateway = async () => {
    const md = method();
    form.querySelectorAll('.method').forEach((x) => x.classList.toggle('active', x.querySelector('input').checked));
    if (md === 'Cash') gw.innerHTML = `<div class="gw-card"><div class="row">${icon('wallet')}<strong>Cash at desk</strong></div><p class="small muted">Collect ${inr(amountEl.value)} and hand over the printed receipt.</p></div>`;
    if (md === 'UPI') {
      gw.innerHTML = `<div class="gw-card" style="text-align:center"><div class="qr-box" style="border:0;padding:6px"><div id="upiQr"></div></div><p class="small muted">Scan with any UPI app · <span class="mono">smartlib@upi</span></p></div>`;
      renderQr(gw.querySelector('#upiQr'), `upi://pay?pa=smartlib@upi&pn=SmartLib&am=${Number(amountEl.value) || 0}&cu=INR`, 130).catch(() => {});
    }
    if (md === 'Card') gw.innerHTML = `<div class="gw-card"><div class="field"><label>Card number</label><input class="input mono" name="card" inputmode="numeric" placeholder="4111 1111 1111 1111" maxlength="19" pattern="[0-9 ]{19}" title="Enter a 16-digit card number"></div>
      <div class="form-grid" style="margin-top:10px"><div class="field"><label>Expiry</label><input class="input mono" name="exp" placeholder="MM/YY" maxlength="5" pattern="(0[1-9]|1[0-2])/[0-9]{2}" title="Use MM/YY"></div><div class="field"><label>CVV</label><input class="input mono" name="cvv" type="password" maxlength="3" pattern="[0-9]{3}" title="3 digits"></div></div></div>`;
    if (md === 'Bank Transfer') gw.innerHTML = `<div class="gw-card"><div class="kv"><div><small>Account</small><strong class="mono">SmartLib Library</strong></div><div><small>A/C No.</small><strong class="mono">5012 3456 7890</strong></div><div><small>IFSC</small><strong class="mono">SBIN0001234</strong></div><div><small>Bank</small><strong>State Bank of India</strong></div></div>
      <label class="switch" style="margin-top:12px"><input type="checkbox" name="pending"><span class="track"></span><span class="small">Awaiting confirmation (record as Pending)</span></label></div>`;
    const card = gw.querySelector('[name=card]');
    card?.addEventListener('input', () => {
      card.value = card.value.replace(/\D/g, '').slice(0, 16).replace(/(.{4})/g, '$1 ').trim();
    });
  };
  form.querySelectorAll('input[name=method]').forEach((r) => r.addEventListener('change', renderGateway));
  amountEl.addEventListener('change', () => method() === 'UPI' && renderGateway());
  renderGateway();

  const btn = m.el.querySelector('#paySubmit');
  btn.onclick = async () => {
    const extra = () => {
      const e = {};
      if (fine && Number(amountEl.value) > remaining) e.amount = `Cannot exceed ${inr(remaining)}`;
      if (method() === 'Card') ['card', 'exp', 'cvv'].forEach((k) => !gw.querySelector(`[name=${k}]`).value && (e[k] = 'Required'));
      return e;
    };
    if (!fine && !mp.value) return toast('Select a member', 'warning');
    if (!validateForm(form, extra)) return;
    const d = formData(form);
    await withLoading(btn, async () => {
      // Simulated gateway processing
      gw.innerHTML = `<div class="gw-card gw-processing"><div class="spinner"></div><strong>Processing ${h(d.method)} payment…</strong><small class="muted">Contacting demo gateway</small></div>`;
      await new Promise((r) => setTimeout(r, d.method === 'Cash' ? 400 : 1300));
      try {
        const res = await api.post('/payments', {
          fine: fine?.fineId,
          member: mp?.value?.memberId,
          amount: Number(d.amount),
          method: d.method,
          reason: fine ? undefined : d.reason,
          notes: d.notes,
          status: d.pending ? 'Pending' : 'Paid',
        });
        gw.innerHTML = `<div class="gw-card gw-success"><div class="success-check">${icon('check')}</div><strong>${h(res.message)}</strong><small class="muted">Ref ${h(res.data.reference)}</small></div>`;
        toast(res.message, 'success', 'Payment recorded');
        onDone?.(res);
        btn.outerHTML = res.data.receiptNo
          ? `<button class="btn btn-gold" id="viewReceipt">${icon('receipt')}View receipt</button>`
          : '<button class="btn btn-primary" data-close>Done</button>';
        m.el.querySelector('[data-close].btn')?.remove();
        m.el.querySelector('#viewReceipt')?.addEventListener('click', () => {
          m.close();
          openReceipt(res.data.paymentId);
        });
      } catch (e) {
        renderGateway();
        applyServerErrors(form, e);
      }
    });
  };
}

export async function openReceipt(paymentId) {
  const m = openModal({ title: 'Payment receipt', size: 'modal-sm', body: '<div class="skeleton" style="height:380px"></div>', footer: `<button class="btn" data-close>Close</button><button class="btn btn-primary" data-print>${icon('printer')}Print receipt</button>` });
  m.el.querySelector('[data-print]').onclick = () => printModal(m);
  try {
    const { data: p, library } = await api.get(`/payments/${paymentId}`);
    const paidLike = ['Paid', 'Partially Paid'].includes(p.status);
    m.body.innerHTML = `<div class="receipt">
      <div class="r-head"><div class="brand-mark" style="margin:0 auto 8px;width:40px;height:40px">${icon('book')}</div><h3>${h(library.name)}</h3><div style="color:#64748b;font-size:12px">Official payment receipt</div></div>
      <div class="r-row"><span>Receipt No.</span><strong class="mono">${h(p.receiptNo || '— (pending)')}</strong></div>
      <div class="r-row"><span>Payment ID</span><span class="mono">${h(p.paymentId)}</span></div>
      <div class="r-row"><span>Date</span><span>${fmtDateTime(p.date)}</span></div>
      <div class="r-row"><span>Member</span><span>${h(p.member?.name)} (${h(p.member?.memberId)})</span></div>
      ${p.transactionId ? `<div class="r-row"><span>Transaction</span><span class="mono">${h(p.transactionId)}</span></div>` : ''}
      ${p.fine?.book ? `<div class="r-row"><span>Book</span><span>${h(p.fine.book.title)}</span></div>` : ''}
      <div class="r-row"><span>Reason</span><span style="text-align:right">${h(p.reason)}</span></div>
      <div class="r-row"><span>Method</span><span>${h(p.method)}</span></div>
      <div class="r-row"><span>Reference</span><span class="mono">${h(p.reference || '—')}</span></div>
      <div class="r-row"><span>Received by</span><span>${h(p.collectedByName || '—')}</span></div>
      <div class="r-row r-total"><span style="color:#0f172a">${p.status === 'Waived' ? 'Amount waived' : 'Amount paid'}</span><span>${inr(p.amount, 2)}</span></div>
      <div style="text-align:center"><span class="r-stamp" style="${paidLike ? '' : 'border-color:#d97706;color:#d97706'}">${h(p.status.toUpperCase())}</span></div>
      <p style="text-align:center;color:#94a3b8;font-size:11px;margin-top:14px">Computer generated receipt · No signature required</p></div>`;
  } catch (e) {
    m.body.innerHTML = `<div class="callout error">${icon('alert')}${h(e.message)}</div>`;
  }
}

/* ============================== Book form ============================== */

let catalogueCache = null;
async function catalogue() {
  if (!catalogueCache) {
    const [c, a, s] = await Promise.all([api.get('/categories'), api.get('/authors'), api.get('/shelves')]);
    catalogueCache = { categories: c.data, authors: a.data, shelves: s.data };
  }
  return catalogueCache;
}

export async function openBookForm({ book = null, onSaved } = {}) {
  let cat;
  try {
    cat = await catalogue();
  } catch (e) {
    return toastError(e);
  }
  const b = book || { quantity: 1, language: 'English', edition: '1st', location: {} };
  const loc = b.location || {};
  const shelfOpts = cat.shelves.map((s) => `<option value="${s.shelfId}" ${s.code === loc.shelfCode ? 'selected' : ''}>${h(s.name)} — Floor ${s.floor}, ${h(s.section)} (${s.availableSpace} free)</option>`).join('');
  const m = openModal({
    title: book ? `Edit “${book.title}”` : 'Add new book',
    subtitle: book ? `${book.bookId} · last updated ${fmtDate(book.updatedAt)}` : 'Catalogue details, pricing, inventory and exact shelf location',
    size: 'modal-xl',
    body: `<form id="bookForm" novalidate class="book-form">
      <div class="bf-cover">
        <div id="coverPreview">${bookCover(b, 'cover-lg')}</div>
        <label class="btn btn-sm btn-block" style="margin-top:12px">${icon('upload')}Upload cover<input type="file" accept="image/*" id="coverFile" hidden></label>
        <input type="hidden" name="coverImage" value="${h(b.coverImage || '')}">
        <p class="field-hint" style="margin-top:8px;text-align:center">No cover? One is fetched by ISBN or generated automatically.</p>
      </div>
      <div class="form-grid form-grid-3">
        <div class="form-section">Book details</div>
        <div class="field" style="grid-column:span 2"><label for="f-title">Book name <span class="req">*</span></label><input class="input" id="f-title" name="title" required maxlength="200" value="${h(b.title || '')}"></div>
        <div class="field"><label for="f-isbn">ISBN <span class="req">*</span></label><input class="input mono" id="f-isbn" name="isbn" required pattern="(97[89])?[0-9]{9}[0-9X]" title="10 or 13 digit ISBN, digits only" value="${h(b.isbn || '')}"></div>
        <div class="field"><label for="f-author">Author <span class="req">*</span></label><input class="input" id="f-author" name="authorName" list="authorList" required value="${h(b.authorName || '')}"><datalist id="authorList">${cat.authors.map((a) => `<option value="${h(a.name)}">`).join('')}</datalist><span class="field-hint">New names create an author automatically</span></div>
        <div class="field"><label for="f-publisher">Publisher</label><input class="input" id="f-publisher" name="publisher" value="${h(b.publisher || '')}"></div>
        <div class="field"><label for="f-pubdate">Publication date</label><input class="input" type="date" id="f-pubdate" name="publicationDate" max="${isoDate()}" value="${b.publicationDate ? isoDate(b.publicationDate) : ''}"></div>
        <div class="field"><label for="f-cat">Category <span class="req">*</span></label><select class="select" id="f-cat" name="category" required><option value="">Select…</option>${cat.categories.map((c) => `<option value="${c._id}" ${String(c._id) === String(b.category?._id || b.category) ? 'selected' : ''}>${h(c.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="f-sub">Subcategory</label><input class="input" id="f-sub" name="subcategory" list="subList" value="${h(b.subcategory || '')}"><datalist id="subList"></datalist></div>
        <div class="field"><label for="f-lang">Language</label><input class="input" id="f-lang" name="language" list="langList" value="${h(b.language || 'English')}"><datalist id="langList"><option value="English"><option value="Hindi"><option value="Marathi"><option value="Tamil"><option value="Bengali"><option value="Telugu"></datalist></div>
        <div class="field"><label for="f-ed">Edition</label><input class="input" id="f-ed" name="edition" value="${h(b.edition || '')}"></div>
        <div class="field"><label for="f-pages">Number of pages</label><input class="input" type="number" id="f-pages" name="pages" min="0" value="${b.pages ?? ''}"></div>
        <div class="field full"><label for="f-desc">Description</label><textarea class="textarea" id="f-desc" name="description" maxlength="5000" rows="3">${h(b.description || '')}</textarea></div>

        <div class="form-section">Pricing (₹)</div>
        <div class="field"><label for="f-price">Price <span class="req">*</span></label><div class="input-group"><span class="input-prefix">₹</span><input class="input with-prefix" type="number" id="f-price" name="price" min="0" step="0.01" required value="${b.price ?? ''}"></div></div>
        <div class="field"><label for="f-pp">Purchase price</label><div class="input-group"><span class="input-prefix">₹</span><input class="input with-prefix" type="number" id="f-pp" name="purchasePrice" min="0" step="0.01" value="${b.purchasePrice ?? ''}"></div></div>
        <div class="field"><label for="f-cv">Current value</label><div class="input-group"><span class="input-prefix">₹</span><input class="input with-prefix" type="number" id="f-cv" name="currentValue" min="0" step="0.01" value="${b.currentValue ?? ''}"></div><span class="field-hint">Defaults to price</span></div>

        <div class="form-section">Inventory</div>
        <div class="field"><label for="f-qty">Quantity (total copies) <span class="req">*</span></label><input class="input" type="number" id="f-qty" name="quantity" min="1" max="10000" required value="${b.quantity ?? 1}"></div>
        <div class="field"><label for="f-lost">Lost copies</label><input class="input" type="number" id="f-lost" name="lostCopies" min="0" value="${b.lostCopies ?? 0}"></div>
        <div class="field"><label for="f-dmg">Damaged copies</label><input class="input" type="number" id="f-dmg" name="damagedCopies" min="0" value="${b.damagedCopies ?? 0}"></div>

        <div class="form-section">${icon('mapPin')} Exact shelf location</div>
        <div class="field full"><label for="f-shelf">Shelf <span class="req">*</span></label><select class="select" id="f-shelf" name="shelf" required><option value="">Select shelf…</option>${shelfOpts}</select></div>
        <div class="field"><label for="f-rack">Rack <span class="req">*</span></label><select class="select" id="f-rack" name="rack" required></select></div>
        <div class="field"><label for="f-row">Row <span class="req">*</span></label><select class="select" id="f-row" name="row" required></select></div>
        <div class="field"><label for="f-pos">Position <span class="req">*</span></label><input class="input" type="number" id="f-pos" name="position" min="1" max="999" required value="${loc.position ? Number(loc.position) : ''}"></div>
        <div class="full" id="locPreview"></div>
      </div>
    </form>`,
    footer: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="bookSave">${icon('check')}${book ? 'Save changes' : 'Save book'}</button>`,
  });
  const form = m.el.querySelector('#bookForm');
  const shelfSel = form.shelf;
  const fillRackRow = (keep) => {
    const s = cat.shelves.find((x) => x.shelfId === shelfSel.value);
    const racks = s ? s.racks : 0;
    const rows = s ? s.rowsPerRack : 0;
    form.rack.innerHTML = `<option value="">—</option>${Array.from({ length: racks }, (_, i) => `<option value="${String(i + 1).padStart(2, '0')}">${String(i + 1).padStart(2, '0')}</option>`).join('')}`;
    form.row.innerHTML = `<option value="">—</option>${Array.from({ length: rows }, (_, i) => `<option>${String.fromCharCode(65 + i)}</option>`).join('')}`;
    if (keep) {
      form.rack.value = loc.rack || '';
      form.row.value = loc.row || '';
    }
    preview();
  };
  const preview = () => {
    const s = cat.shelves.find((x) => x.shelfId === shelfSel.value);
    const el = m.el.querySelector('#locPreview');
    if (!s) return (el.innerHTML = '');
    const pos = form.position.value ? String(form.position.value).padStart(2, '0') : '—';
    el.innerHTML = locationCard({ location: { floor: s.floor, section: s.section, shelfCode: s.code, rack: form.rack.value || '—', row: form.row.value || '—', position: pos } }, { actions: false });
  };
  const fillSubs = () => {
    const c = cat.categories.find((x) => String(x._id) === form.category.value);
    m.el.querySelector('#subList').innerHTML = (c?.subcategories || []).map((s) => `<option value="${h(s)}">`).join('');
  };
  shelfSel.addEventListener('change', () => fillRackRow(false));
  [form.rack, form.row, form.position].forEach((x) => x.addEventListener('input', preview));
  form.category.addEventListener('change', fillSubs);
  fillRackRow(true);
  fillSubs();

  const refreshCover = () => {
    m.el.querySelector('#coverPreview').innerHTML = bookCover({ title: form.title.value || 'New Book', authorName: form.authorName.value, isbn: form.isbn.value, coverImage: form.coverImage.value }, 'cover-lg');
  };
  form.title.addEventListener('change', refreshCover);
  form.isbn.addEventListener('change', refreshCover);
  m.el.querySelector('#coverFile').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      form.coverImage.value = await imageToDataUrl(f, 400);
      refreshCover();
    } catch (err) {
      toastError(err);
    }
  });

  const btn = m.el.querySelector('#bookSave');
  btn.onclick = async () => {
    const ok = validateForm(form, (d) => {
      const e = {};
      if (Number(d.lostCopies || 0) + Number(d.damagedCopies || 0) > Number(d.quantity || 0)) e.lostCopies = 'Lost + damaged cannot exceed quantity';
      return e;
    });
    if (!ok) return;
    const d = formData(form);
    const payload = {
      title: d.title, isbn: d.isbn.replace(/-/g, ''), authorName: d.authorName, publisher: d.publisher, publicationDate: d.publicationDate || undefined,
      category: d.category, subcategory: d.subcategory, language: d.language || 'English', edition: d.edition, pages: d.pages || 0, description: d.description,
      price: Number(d.price), purchasePrice: Number(d.purchasePrice || 0), currentValue: Number(d.currentValue || d.price), quantity: Number(d.quantity),
      lostCopies: Number(d.lostCopies || 0), damagedCopies: Number(d.damagedCopies || 0), coverImage: d.coverImage,
      location: { shelf: d.shelf, rack: d.rack, row: d.row, position: d.position },
    };
    await withLoading(btn, async () => {
      try {
        const res = book ? await api.put(`/books/${book.bookId}`, payload) : await api.post('/books', payload);
        catalogueCache = null;
        toast(book ? 'Book details updated' : `“${res.data.title}” added as ${res.data.bookId}`, 'success', book ? 'Saved' : 'Book added');
        m.close();
        onSaved?.(res.data);
      } catch (e) {
        applyServerErrors(form, e);
      }
    });
  };
}

/* ============================== Move book ============================== */

export async function openMoveBook(book, onDone) {
  let cat;
  try {
    cat = await catalogue();
  } catch (e) {
    return toastError(e);
  }
  const m = openModal({
    title: 'Move book to another shelf',
    subtitle: `${h(book.title)} · currently Floor ${book.location?.floor}, Shelf ${h(book.location?.shelfCode)}, Rack ${h(book.location?.rack)}, Row ${h(book.location?.row)}, Position ${h(book.location?.position)}`,
    body: `<form id="moveForm" novalidate class="form-grid form-grid-3">
      <div class="field full"><label>Target shelf <span class="req">*</span></label><select class="select" name="shelf" required><option value="">Select…</option>${cat.shelves.map((s) => `<option value="${s.shelfId}" ${s.status !== 'Active' ? 'disabled' : ''}>${h(s.name)} — F${s.floor} ${h(s.section)} · ${s.availableSpace} free${s.status !== 'Active' ? ` (${s.status})` : ''}</option>`).join('')}</select></div>
      <div class="field"><label>Rack <span class="req">*</span></label><select class="select" name="rack" required></select></div>
      <div class="field"><label>Row <span class="req">*</span></label><select class="select" name="row" required></select></div>
      <div class="field"><label>Position <span class="req">*</span></label><input class="input" type="number" min="1" name="position" required></div>
    </form>`,
    footer: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="moveSave">${icon('move')}Move book</button>`,
  });
  const f = m.el.querySelector('#moveForm');
  f.shelf.addEventListener('change', () => {
    const s = cat.shelves.find((x) => x.shelfId === f.shelf.value);
    f.rack.innerHTML = Array.from({ length: s?.racks || 0 }, (_, i) => `<option>${String(i + 1).padStart(2, '0')}</option>`).join('');
    f.row.innerHTML = Array.from({ length: s?.rowsPerRack || 0 }, (_, i) => `<option>${String.fromCharCode(65 + i)}</option>`).join('');
  });
  const btn = m.el.querySelector('#moveSave');
  btn.onclick = async () => {
    if (!validateForm(f)) return;
    await withLoading(btn, async () => {
      try {
        const res = await api.patch(`/books/${book.bookId}/location`, formData(f));
        catalogueCache = null;
        const l = res.data.location;
        toast(`Now at Floor ${l.floor}, ${l.section}, Shelf ${l.shelfCode}, Rack ${l.rack}, Row ${l.row}, Position ${l.position}`, 'success', 'Book moved');
        m.close();
        onDone?.(res.data);
      } catch (e) {
        applyServerErrors(f, e);
      }
    });
  };
}

/* ============================ Due date label ============================ */

export function dueLabel(issue) {
  if (!['Issued', 'Overdue'].includes(issue.status)) return fmtDate(issue.dueDate);
  const d = daysUntil(issue.dueDate);
  if (d < 0) return `<span class="text-error">${fmtDate(issue.dueDate)}<br><small>${-d} day${d === -1 ? '' : 's'} overdue</small></span>`;
  if (d <= 2) return `<span class="text-warning">${fmtDate(issue.dueDate)}<br><small>${d === 0 ? 'due today' : `due in ${d} day${d > 1 ? 's' : ''}`}</small></span>`;
  return `${fmtDate(issue.dueDate)}<br><small class="muted">in ${d} days</small>`;
}
