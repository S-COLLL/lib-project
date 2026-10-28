import {
  initPage, api, h, inr, icon, badge, toast, toastError, openModal, debounce, fmtDate, skeletonRows, emptyState, errorState,
  renderPagination, isStaff, hasRole, animateCounter, validateForm, formData, applyServerErrors, withLoading, skeletonCards, qp,
} from './app.js';
import { openPaymentModal, entityPicker } from './shared.js';

const user = await initPage('fines');
const staff = isStaff(user);
const manager = hasRole('admin', 'librarian');
const $ = (id) => document.getElementById(id);
const state = { status: qp('status') || 'Outstanding', type: '', search: '', page: 1, rows: [] };

if (staff) {
  $('pageActions').innerHTML = `<button class="btn btn-primary" id="addCharge">${icon('plus')}Add charge</button>`;
  $('addCharge').addEventListener('click', chargeForm);
}
const TABS = [['Outstanding', 'Outstanding'], ['', 'All'], ['Pending', 'Pending'], ['Partially Paid', 'Partially paid'], ['Paid', 'Paid'], ['Waived', 'Waived']];
$('tabs').innerHTML = TABS.map(([k, l]) => `<button class="tab ${k === state.status ? 'active' : ''}" data-s="${k}">${l}</button>`).join('');
$('tabs').addEventListener('click', (e) => {
  const t = e.target.closest('[data-s]');
  if (!t) return;
  state.status = t.dataset.s;
  state.page = 1;
  $('tabs').querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
  load();
});
$('search').addEventListener(
  'input',
  debounce(() => {
    state.search = $('search').value.trim();
    state.page = 1;
    load();
  })
);
$('type').addEventListener('change', () => {
  state.type = $('type').value;
  state.page = 1;
  load();
});

async function loadSummary() {
  $('stats').innerHTML = skeletonCards(4, 100);
  try {
    const { data: s } = await api.get('/fines/summary');
    $('policy').innerHTML = `Late fine: <strong class="gold-text">${inr(s.finePerDay)}/day</strong> — e.g. returned 5 days late = ${inr(s.finePerDay)} × 5 = <strong>${inr(s.finePerDay * 5)}</strong>.`;
    const cards = [
      ['Total fines generated', s.original, 'rupee', 'tone-orange', `${s.count} charges`],
      ['Collected', s.paid, 'wallet', 'tone-green', 'Paid by members'],
      ['Discounts & waivers', s.discount + s.waived, 'gift', 'tone-gold', 'Written off'],
      ['Outstanding', s.remaining, 'alert', 'tone-red', `${s.pendingCount} unpaid charges`],
    ];
    $('stats').innerHTML = cards
      .map(([l, v, ic, tone, foot], i) => `<div class="card stat-card reveal ${tone}" style="--i:${i}"><div class="stat-top"><span class="stat-label">${l}</span><span class="stat-icon">${icon(ic)}</span></div><div class="stat-value" data-v="${v}">₹0</div><div class="stat-foot">${foot}</div></div>`)
      .join('');
    $('stats').querySelectorAll('[data-v]').forEach((el) => animateCounter(el, Number(el.dataset.v), { format: (x) => inr(x) }));
  } catch (e) {
    $('stats').innerHTML = `<div style="grid-column:1/-1">${errorState(e.message)}</div>`;
  }
}

async function load() {
  $('rows').innerHTML = skeletonRows(11, 6);
  try {
    const res = await api.get('/fines', { status: state.status, type: state.type, search: state.search, page: state.page, limit: 15 });
    state.rows = res.data;
    $('rows').innerHTML = res.data.length
      ? res.data
          .map(
            (f, i) => `<tr style="--i:${i}"><td class="mono">${f.fineId}</td>
          <td>${staff ? `<a href="members.html?id=${f.member?.memberId}" class="t-title" style="color:var(--text)">${h(f.member?.name)}</a>` : `<span class="t-title">${h(f.member?.name)}</span>`}<div class="t-sub">${h(f.member?.memberId)}</div></td>
          <td>${h(f.type)}</td><td>${f.transactionId ? `<span class="mono small">${f.transactionId}</span>` : '—'}${f.book ? `<div class="t-sub">${h(f.book.title)}</div>` : ''}</td>
          <td class="small">${h(f.description || '—')}<div class="t-sub">${fmtDate(f.createdAt)}</div></td>
          <td class="amount">${inr(f.originalAmount)}</td><td class="amount">${f.discount ? `− ${inr(f.discount)}` : '—'}</td><td class="amount">${inr(f.paidAmount)}</td>
          <td class="amount ${f.remainingAmount ? 'text-error' : ''}">${inr(f.remainingAmount)}</td><td>${badge(f.status)}</td>
          <td><div class="actions">${
            f.remainingAmount > 0 && staff
              ? `<button class="btn btn-sm btn-primary" data-pay="${f.fineId}">${icon('card')}Pay</button>
                 ${manager ? `<button class="btn btn-sm btn-icon btn-ghost" data-discount="${f.fineId}" title="Apply discount" aria-label="Apply discount">${icon('percent')}</button><button class="btn btn-sm btn-icon btn-ghost" data-waive="${f.fineId}" title="Waive" aria-label="Waive fine">${icon('gift')}</button>` : ''}`
              : ''
          }</div></td></tr>`
          )
          .join('')
      : `<tr><td colspan="11">${emptyState(state.status === 'Outstanding' ? 'No outstanding fines' : 'No fines found', 'All dues are settled.', 'checkCircle')}</td></tr>`;
    renderPagination($('pagination'), res.pagination, (p) => {
      state.page = p;
      load();
    });
  } catch (e) {
    $('rows').innerHTML = `<tr><td colspan="11">${errorState(e.message)}</td></tr>`;
  }
}

const refresh = () => {
  load();
  loadSummary();
};

$('rows').addEventListener('click', (e) => {
  const find = (attr) => {
    const el = e.target.closest(`[data-${attr}]`);
    return el ? state.rows.find((f) => f.fineId === el.dataset[attr]) : null;
  };
  const pay = find('pay');
  const disc = find('discount');
  const waive = find('waive');
  if (pay) openPaymentModal({ fine: pay, onDone: refresh });
  if (disc) adjust(disc, 'discount');
  if (waive) adjust(waive, 'waive');
});

function adjust(f, kind) {
  const isDisc = kind === 'discount';
  const m = openModal({
    title: isDisc ? 'Apply discount' : 'Waive fine',
    subtitle: `${f.fineId} · ${h(f.member?.name)} · remaining ${inr(f.remainingAmount)}`,
    size: 'modal-sm',
    body: `<form id="adjF" novalidate class="stack" style="gap:14px">${
      isDisc
        ? `<div class="field"><label>Discount amount (₹) <span class="req">*</span></label><input class="input" type="number" name="discount" min="0" max="${f.originalAmount - f.paidAmount - f.waivedAmount}" required value="${f.discount || ''}"><span class="field-hint">Replaces any previous discount</span></div>`
        : `<div class="callout warn">${icon('alert')}<span>The remaining ${inr(f.remainingAmount)} will be written off and recorded as a waived payment.</span></div>`
    }<div class="field"><label>Reason</label><input class="input" name="reason" placeholder="e.g. Medical emergency"></div></form>`,
    footer: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="adjGo">${isDisc ? 'Apply discount' : 'Waive fine'}</button>`,
  });
  const form = m.el.querySelector('#adjF');
  const btn = m.el.querySelector('#adjGo');
  btn.onclick = async () => {
    if (!validateForm(form)) return;
    const d = formData(form);
    await withLoading(btn, async () => {
      try {
        const res = isDisc ? await api.patch(`/fines/${f.fineId}/discount`, { discount: Number(d.discount) }) : await api.patch(`/fines/${f.fineId}/waive`, { reason: d.reason });
        toast(res.message);
        m.close();
        refresh();
      } catch (e) {
        applyServerErrors(form, e);
      }
    });
  };
}

function chargeForm() {
  const m = openModal({
    title: 'Add charge',
    subtitle: 'Replacement cost, membership fee or other charges',
    body: `<form id="chF" novalidate class="stack" style="gap:14px">
      <div class="field"><label>Member <span class="req">*</span></label><div id="chMember"></div></div>
      <div class="field"><label>Type <span class="req">*</span></label><select class="select" name="type" required><option>Replacement</option><option>Damage</option><option>Membership Fee</option><option>Other</option></select></div>
      <div class="field"><label>Amount (₹) <span class="req">*</span></label><input class="input" type="number" name="amount" min="1" required></div>
      <div class="field"><label>Description</label><input class="input" name="description" placeholder="What is this charge for?"></div></form>`,
    footer: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="chGo">${icon('plus')}Add charge</button>`,
  });
  const picker = entityPicker(m.el.querySelector('#chMember'), { type: 'member', placeholder: 'Search member…' });
  const form = m.el.querySelector('#chF');
  const btn = m.el.querySelector('#chGo');
  btn.onclick = async () => {
    if (!picker.value) return toast('Select a member', 'warning');
    if (!validateForm(form)) return;
    await withLoading(btn, async () => {
      try {
        const d = formData(form);
        await api.post('/fines', { ...d, amount: Number(d.amount), member: picker.value.memberId });
        toast('Charge added');
        m.close();
        refresh();
      } catch (e) {
        applyServerErrors(form, e);
      }
    });
  };
}

refresh();
