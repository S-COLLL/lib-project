import {
  initPage, api, h, inr, icon, badge, toast, toastError, fmtDate, isoDate, skeletonRows, emptyState, errorState, renderPagination,
  qp, bookCover, withLoading, avatar,
} from './app.js';
import { openPaymentModal } from './shared.js';

await initPage('returns', { staffOnly: true });
const $ = (id) => document.getElementById(id);
let results = [];
let settings = { finePerDay: 10, damageChargePercent: 30, lostProcessingFee: 50 };
let current = null;

const idle = () => {
  $('returnPanel').innerHTML = emptyState('Select a loan', 'Search for a transaction, member, book or ISBN, then choose the loan being returned.', 'undo');
};
idle();

$('quickChips').innerHTML = `<span class="small muted" style="align-self:center">Quick:</span><button class="chip" data-q="overdue">${icon('alert').replace('<svg', '<svg style="width:14px;height:14px"')}All overdue loans</button>`;
$('quickChips').addEventListener('click', async (e) => {
  if (!e.target.closest('[data-q]')) return;
  try {
    const { data } = await api.get('/issues', { status: 'Overdue', limit: 50 });
    const ids = data.map((i) => i.transactionId);
    results = [];
    for (const tid of ids) {
      const r = await api.get('/returns/lookup', { q: tid });
      results.push(...r.data);
      settings = r.settings;
    }
    renderResults(`${results.length} overdue loan(s)`);
  } catch (err) {
    toastError(err);
  }
});

$('lookupForm').addEventListener('submit', (e) => {
  e.preventDefault();
  lookup($('q').value.trim());
});

async function lookup(q) {
  if (!q) return $('q').focus();
  history.replaceState(null, '', `?q=${encodeURIComponent(q)}`);
  $('results').innerHTML = '<div class="skeleton" style="height:80px;border-radius:14px"></div><div class="skeleton" style="height:80px;border-radius:14px"></div>';
  await withLoading($('lookupBtn'), async () => {
    try {
      const res = await api.get('/returns/lookup', { q });
      results = res.data;
      settings = res.settings;
      renderResults(`${results.length} active loan(s) for “${q}”`);
      if (results.length === 1) select(results[0].transactionId);
    } catch (e) {
      $('results').innerHTML = errorState(e.message);
    }
  });
}

function renderResults(label) {
  if (!results.length) {
    $('results').innerHTML = `<div class="card">${emptyState('No active loans found', 'Check the ID — only books that are currently issued can be returned.', 'search')}</div>`;
    idle();
    return;
  }
  $('results').innerHTML =
    `<div class="small muted">${h(label)}</div>` +
    results
      .map(
        (i, k) => `<div class="result-card reveal" style="--i:${k}" data-tid="${i.transactionId}" role="button" tabindex="0">
        ${bookCover(i.book, 'cover-sm')}
        <div style="flex:1;min-width:0"><div class="row wrap" style="gap:6px"><span class="mono small">${i.transactionId}</span>${badge(i.status)}</div>
          <div class="t-title" style="font-weight:600">${h(i.bookTitle)}</div>
          <div class="small muted">${h(i.memberName)} (${i.memberCode}) · issued ${fmtDate(i.issueDate)} · due ${fmtDate(i.dueDate)}</div></div>
        <div class="late">${i.charges.daysOverdue ? `${i.charges.daysOverdue} days late<div class="small">${inr(i.charges.lateFine)}</div>` : '<span class="text-success small">On time</span>'}</div></div>`
      )
      .join('');
}

$('results').addEventListener('click', (e) => {
  const c = e.target.closest('[data-tid]');
  if (c) select(c.dataset.tid);
});
$('results').addEventListener('keydown', (e) => {
  const c = e.target.closest('[data-tid]');
  if (c && (e.key === 'Enter' || e.key === ' ')) {
    e.preventDefault();
    select(c.dataset.tid);
  }
});

const DAY = 86400000;
const dayStart = (d) => new Date(new Date(d).setHours(0, 0, 0, 0));
const daysLate = (due, ret) => Math.max(0, Math.floor((dayStart(ret) - dayStart(due)) / DAY));

function select(tid) {
  current = results.find((r) => r.transactionId === tid);
  document.querySelectorAll('.result-card').forEach((c) => c.classList.toggle('active', c.dataset.tid === tid));
  const i = current;
  const damageDefault = Math.round((i.book.price * settings.damageChargePercent) / 100);
  $('returnPanel').innerHTML = `<div style="animation:panelIn .4s cubic-bezier(.22,1,.36,1)">
    <div class="card-head" style="padding-bottom:4px"><div><h2>Return ${h(i.transactionId)}</h2><div class="ch-sub">Processed by you</div></div></div>
    <div class="card-body">
      <div class="row" style="gap:12px">${bookCover(i.book, 'cover-sm')}<div><div style="font-weight:600">${h(i.bookTitle)}</div><div class="small muted">${i.bookCode} · ISBN ${h(i.book.isbn)} · ${inr(i.book.price)}</div></div></div>
      <div class="row" style="gap:10px;margin-top:10px">${avatar(i.memberName, null, 'avatar-sm')}<div class="small"><strong>${h(i.memberName)}</strong> · ${i.memberCode}${i.member?.pendingFine ? ` · <span class="text-error">${inr(i.member.pendingFine)} already due</span>` : ''}</div></div>
      <form id="retForm" class="stack" style="gap:12px;margin-top:14px" novalidate>
        <div class="kv"><div><small>Issue date</small><strong>${fmtDate(i.issueDate)}</strong></div><div><small>Due date</small><strong>${fmtDate(i.dueDate)}</strong></div></div>
        <div class="field"><label for="retDate">Return date</label><input class="input" type="date" id="retDate" name="returnDate" value="${isoDate()}" max="${isoDate()}" min="${isoDate(i.issueDate)}"></div>
        <div class="overdue-banner" id="odBanner"></div>
        <div class="field"><label>Book condition</label><div class="cond-grid">
          <label class="cond active"><input type="radio" name="condition" value="Good" checked>Good</label>
          <label class="cond dmg"><input type="radio" name="condition" value="Damaged">Damaged</label>
          <label class="cond lost"><input type="radio" name="condition" value="Lost">Lost</label></div></div>
        <div class="field hidden" id="dmgField"><label for="dmg">Damage charge (₹)</label><input class="input" type="number" id="dmg" name="damageCharge" min="0" value="${damageDefault}"><span class="field-hint">Default ${settings.damageChargePercent}% of book price</span></div>
        <div class="field"><label for="remarks">Remarks</label><input class="input" id="remarks" name="remarks" placeholder="Optional"></div>
        <div class="money-summary" id="summary"></div>
        <button class="btn btn-primary btn-lg btn-block" id="confirmReturn" type="submit">${icon('undo')}Confirm return</button>
      </form>
    </div></div>`;
  const form = $('retForm');
  const recalc = () => {
    const cond = form.condition.value;
    form.querySelectorAll('.cond').forEach((c) => c.classList.toggle('active', c.querySelector('input').checked));
    $('dmgField').classList.toggle('hidden', cond !== 'Damaged');
    const days = daysLate(i.dueDate, form.returnDate.value || new Date());
    const late = days * settings.finePerDay;
    const dmg = cond === 'Damaged' ? Number(form.damageCharge.value || 0) : 0;
    const lost = cond === 'Lost' ? i.book.price + settings.lostProcessingFee : 0;
    const banner = $('odBanner');
    banner.classList.toggle('ok', !days);
    banner.innerHTML = days
      ? `<div class="ob-days">${days}</div><div><strong>day${days > 1 ? 's' : ''} overdue</strong><div class="small">Fine = ${inr(settings.finePerDay)} × ${days} = <strong>${inr(late)}</strong></div></div>`
      : `<div class="ob-days">✓</div><div><strong>Returned on time</strong><div class="small">No late fine</div></div>`;
    $('summary').innerHTML = `<div class="ms-row"><span class="muted">Late fine (${days} × ${inr(settings.finePerDay)})</span><span class="amount">${inr(late)}</span></div>
      ${cond === 'Damaged' ? `<div class="ms-row"><span class="muted">Damage charge</span><span class="amount">${inr(dmg)}</span></div>` : ''}
      ${cond === 'Lost' ? `<div class="ms-row"><span class="muted">Replacement (${inr(i.book.price)}) + processing (${inr(settings.lostProcessingFee)})</span><span class="amount">${inr(lost)}</span></div>` : ''}
      <div class="ms-row ms-total"><span>Total fine</span><span class="amount ${late + dmg + lost ? 'text-error' : 'text-success'}">${inr(late + dmg + lost)}</span></div>`;
  };
  form.addEventListener('input', recalc);
  form.addEventListener('change', recalc);
  recalc();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(form));
    await withLoading($('confirmReturn'), async () => {
      try {
        const res = await api.post('/returns', {
          issue: i.transactionId,
          condition: d.condition,
          returnDate: d.returnDate === isoDate() ? undefined : new Date(`${d.returnDate}T12:00:00`).toISOString(),
          damageCharge: d.condition === 'Damaged' ? Number(d.damageCharge) : undefined,
          remarks: d.remarks,
        });
        toast(res.message, res.fines.length ? 'warning' : 'success', 'Book returned');
        showDone(res);
        results = results.filter((r) => r.transactionId !== i.transactionId);
        renderResults(`${results.length} remaining`);
        loadRecent();
      } catch (err) {
        toastError(err);
      }
    });
  });
}

function showDone(res) {
  const total = res.fines.reduce((s, f) => s + f.originalAmount, 0);
  $('returnPanel').innerHTML = `<div class="card-body" style="text-align:center;padding:28px 22px;animation:panelIn .4s cubic-bezier(.22,1,.36,1)">
    <div class="success-check" style="margin:0 auto 14px">${icon('check')}</div>
    <h2>Book checked in</h2><p class="muted small" style="margin:6px 0 14px">${h(res.data.returnId)} · available copies now <strong>${res.book.availableCopies}</strong> of ${res.book.quantity}${res.book.reservedCopies ? ` · ${res.book.reservedCopies} held for reservation` : ''}</p>
    ${res.fines.length
      ? `<div class="money-summary" style="text-align:left">${res.fines.map((f) => `<div class="ms-row"><span>${h(f.type)} <span class="muted small">${f.fineId}</span></span><span class="amount">${inr(f.originalAmount)}</span></div>`).join('')}<div class="ms-row ms-total"><span>Total due</span><span class="amount text-error">${inr(total)}</span></div></div>
         <div class="stack" style="gap:8px;margin-top:14px">${res.fines.map((f) => `<button class="btn btn-primary btn-block" data-pay="${f.fineId}">${icon('card')}Collect ${h(f.type.toLowerCase())} — ${inr(f.originalAmount)}</button>`).join('')}<a class="btn btn-block" href="fines.html">Collect later</a></div>`
      : '<div class="callout success" style="text-align:left">' + icon('checkCircle') + '<span>No fine — returned on time and in good condition.</span></div>'}
  </div>`;
  $('returnPanel').querySelectorAll('[data-pay]').forEach((b) =>
    b.addEventListener('click', () => {
      const f = res.fines.find((x) => x.fineId === b.dataset.pay);
      openPaymentModal({
        fine: { ...f, remainingAmount: f.originalAmount - f.discount - f.paidAmount - f.waivedAmount, member: { name: current?.memberName } },
        onDone: () => {
          b.disabled = true;
          b.innerHTML = `${icon('check')}Paid`;
        },
      });
    })
  );
}

let page = 1;
async function loadRecent() {
  $('recent').innerHTML = skeletonRows(10, 5);
  try {
    const res = await api.get('/returns', { page, limit: 8 });
    $('recent').innerHTML = res.data.length
      ? res.data
          .map(
            (r, k) => `<tr style="--i:${k}"><td class="mono">${r.returnId}</td><td class="mono">${r.transactionId}</td><td>${h(r.member?.name)}<div class="t-sub">${h(r.member?.memberId)}</div></td><td class="t-title">${h(r.book?.title)}</td>
            <td>${fmtDate(r.issueDate)}</td><td>${fmtDate(r.dueDate)}</td><td>${fmtDate(r.returnDate)}</td><td class="${r.daysOverdue ? 'text-error' : ''}">${r.daysOverdue}</td><td>${badge(r.condition)}</td><td class="amount">${r.totalFine ? inr(r.totalFine) : '—'}</td></tr>`
          )
          .join('')
      : `<tr><td colspan="10">${emptyState('No returns yet')}</td></tr>`;
    renderPagination($('pagination'), res.pagination, (p) => {
      page = p;
      loadRecent();
    });
  } catch (e) {
    $('recent').innerHTML = `<tr><td colspan="10">${errorState(e.message)}</td></tr>`;
  }
}

loadRecent();
if (qp('q')) {
  $('q').value = qp('q');
  lookup(qp('q'));
}
