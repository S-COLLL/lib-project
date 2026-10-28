import { initPage, api, h, inr, icon, badge, toast, toastError, debounce, fmtDateTime, skeletonRows, emptyState, errorState, renderPagination, isStaff, animateCounter, qp, confirmDialog } from './app.js';
import { openPaymentModal, openReceipt } from './shared.js';

const user = await initPage('payments');
const staff = isStaff(user);
const $ = (id) => document.getElementById(id);
const state = { search: '', status: '', method: '', from: '', to: '', member: qp('member') || '', page: 1 };

if (staff) {
  $('pageActions').innerHTML = `<button class="btn btn-primary" id="newPay">${icon('plus')}Record payment</button>`;
  $('newPay').addEventListener('click', () => openPaymentModal({ onDone: load }));
}
if (state.member) {
  $('memberFilter').innerHTML = `<div class="callout" style="margin:0 20px 12px">${icon('user')}<span>Showing payment history for <strong>${h(state.member)}</strong>. <a href="payments.html">Show all</a></span></div>`;
}
$('search').addEventListener(
  'input',
  debounce(() => {
    state.search = $('search').value.trim();
    state.page = 1;
    load();
  })
);
['status', 'method', 'from', 'to'].forEach((k) =>
  $(k).addEventListener('change', () => {
    state[k] = $(k).value;
    state.page = 1;
    load();
  })
);

function renderStats(totals) {
  const get = (s) => totals.find((t) => t._id === s) || { amount: 0, count: 0 };
  const collected = get('Paid').amount + get('Partially Paid').amount;
  const cards = [
    ['Money collected', collected, 'wallet', 'tone-green featured', `${get('Paid').count + get('Partially Paid').count} payments`],
    ['Partially paid', get('Partially Paid').amount, 'percent', 'tone-blue', `${get('Partially Paid').count} instalments`],
    ['Pending confirmation', get('Pending').amount, 'clock', 'tone-gold', `${get('Pending').count} awaiting bank confirmation`],
    ['Waived', get('Waived').amount, 'gift', 'tone-navy', `${get('Waived').count} fines written off`],
  ];
  $('stats').innerHTML = cards
    .map(([l, v, ic, tone, foot], i) => `<div class="card stat-card reveal ${tone}" style="--i:${i}"><div class="stat-top"><span class="stat-label">${l}</span><span class="stat-icon">${icon(ic)}</span></div><div class="stat-value" data-v="${v}">₹0</div><div class="stat-foot">${foot}</div></div>`)
    .join('');
  $('stats').querySelectorAll('[data-v]').forEach((el) => animateCounter(el, Number(el.dataset.v), { format: (x) => inr(x) }));
}

async function load() {
  $('rows').innerHTML = skeletonRows(10, 6);
  try {
    const res = await api.get('/payments', { ...state, limit: 15 });
    renderStats(res.totals);
    $('rows').innerHTML = res.data.length
      ? res.data
          .map(
            (p, i) => `<tr style="--i:${i}"><td class="mono">${p.paymentId}</td><td class="mono small">${p.receiptNo || '—'}</td>
          <td><div class="t-title">${h(p.member?.name)}</div><div class="t-sub">${h(p.member?.memberId)}</div></td>
          <td class="mono small">${p.transactionId || '—'}</td><td class="small" style="max-width:260px">${h(p.reason)}</td>
          <td class="amount">${inr(p.amount)}</td><td class="nowrap small">${fmtDateTime(p.date)}</td><td>${h(p.method)}<div class="t-sub mono">${h(p.reference || '')}</div></td><td>${badge(p.status)}</td>
          <td><div class="actions">${p.receiptNo ? `<button class="btn btn-sm" data-receipt="${p.paymentId}">${icon('receipt')}Receipt</button>` : ''}
            ${staff && p.status === 'Pending' ? `<button class="btn btn-sm btn-primary" data-confirm="${p.paymentId}">${icon('check')}Confirm</button>` : ''}
            ${staff ? `<a class="btn btn-sm btn-icon btn-ghost" href="payments.html?member=${p.member?.memberId}" title="Payment history" aria-label="Payment history for ${h(p.member?.name)}">${icon('clock')}</a>` : ''}</div></td></tr>`
          )
          .join('')
      : `<tr><td colspan="10">${emptyState('No payments found', 'Adjust the filters.', 'card')}</td></tr>`;
    renderPagination($('pagination'), res.pagination, (p) => {
      state.page = p;
      load();
    });
  } catch (e) {
    $('rows').innerHTML = `<tr><td colspan="10">${errorState(e.message)}</td></tr>`;
  }
}

$('rows').addEventListener('click', async (e) => {
  const r = e.target.closest('[data-receipt]');
  const c = e.target.closest('[data-confirm]');
  if (r) openReceipt(r.dataset.receipt);
  if (c && (await confirmDialog({ title: 'Confirm payment received?', message: 'Mark this bank transfer as received and generate a receipt.', confirmText: 'Confirm' }))) {
    try {
      const res = await api.patch(`/payments/${c.dataset.confirm}/confirm`);
      toast(res.message);
      load();
      openReceipt(res.data.paymentId);
    } catch (err) {
      toastError(err);
    }
  }
});

load();
