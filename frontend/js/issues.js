import { initPage, api, h, inr, icon, badge, debounce, fmtDate, skeletonRows, emptyState, errorState, renderPagination, isStaff, qp, bookCover, openModal } from './app.js';
import { openIssueModal, renewIssue, dueLabel } from './shared.js';

const user = await initPage('issues');
const staff = isStaff(user);
const $ = (id) => document.getElementById(id);
const state = { status: qp('status') || (staff ? '' : 'Active'), search: '', from: '', to: '', page: 1, rows: [] };

if (staff) {
  $('pageActions').innerHTML = `<button class="btn btn-primary" id="newIssue">${icon('plus')}Issue book</button>`;
  $('newIssue').addEventListener('click', () => openIssueModal({ onDone: load }));
  if (qp('new')) openIssueModal({ onDone: load });
} else {
  $('title').textContent = 'My loans';
  $('crumb').textContent = 'My Loans';
  $('subtitle').textContent = 'Books you have borrowed, due dates and renewals.';
  $('memberCol').remove();
  $('staffCol').remove();
}

const TABS = [['', 'All'], ['Active', 'Active'], ['Issued', 'Issued'], ['Overdue', 'Overdue'], ['Returned', 'Returned'], ['Lost', 'Lost'], ['Damaged', 'Damaged']];
$('statusTabs').innerHTML = TABS.map(([k, l]) => `<button class="tab ${state.status === k ? 'active' : ''}" data-s="${k}">${l}</button>`).join('');
$('statusTabs').addEventListener('click', (e) => {
  const t = e.target.closest('[data-s]');
  if (!t) return;
  state.status = t.dataset.s;
  state.page = 1;
  $('statusTabs').querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
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
['from', 'to'].forEach((k) =>
  $(k).addEventListener('change', () => {
    state[k] = $(k).value;
    state.page = 1;
    load();
  })
);

const cols = staff ? 11 : 9;
async function load() {
  $('rows').innerHTML = skeletonRows(cols, 6);
  try {
    const res = await api.get('/issues', { status: state.status, search: state.search, from: state.from, to: state.to, page: state.page, limit: 15 });
    state.rows = res.data;
    $('rows').innerHTML = res.data.length
      ? res.data
          .map((i, k) => {
            const active = ['Issued', 'Overdue'].includes(i.status);
            return `<tr style="--i:${k}">
            <td class="mono"><button class="link-btn mono" data-detail="${i.transactionId}">${i.transactionId}</button></td>
            ${staff ? `<td><a href="members.html?id=${i.memberCode}" class="t-title" style="color:var(--text)">${h(i.memberName)}</a><div class="t-sub">${i.memberCode}</div></td>` : ''}
            <td><div class="row">${bookCover(i.book || { title: i.bookTitle }, 'cover-xs')}<div><a class="t-title" href="book-details.html?id=${i.bookCode}" style="color:var(--text)">${h(i.bookTitle)}</a><div class="t-sub">${i.bookCode}</div></div></div></td>
            <td class="nowrap">${fmtDate(i.issueDate)}</td><td class="nowrap">${dueLabel(i)}</td><td class="nowrap">${i.returnDate ? fmtDate(i.returnDate) : '—'}</td>
            <td>${i.renewalCount}</td>${staff ? `<td class="small">${h(i.staffName || '—')}</td>` : ''}<td>${badge(i.status)}</td>
            <td class="amount">${active && i.estimatedFine ? `<span class="text-error" title="Accruing">${inr(i.estimatedFine)}*</span>` : i.fineAmount ? inr(i.fineAmount) : '—'}</td>
            <td><div class="actions">${active ? `<button class="btn btn-sm" data-renew="${i.transactionId}" ${i.status === 'Overdue' ? 'disabled title="Overdue loans cannot be renewed"' : ''}>${icon('refresh')}Renew</button>${staff ? `<a class="btn btn-sm btn-primary" href="returns.html?q=${i.transactionId}">${icon('undo')}Return</a>` : ''}` : ''}</div></td></tr>`;
          })
          .join('')
      : `<tr><td colspan="${cols}">${emptyState(staff ? 'No transactions found' : 'No loans here', staff ? 'Adjust the filters or issue a new book.' : 'Visit the catalogue to borrow a book.', 'bookOpen')}</td></tr>`;
    renderPagination($('pagination'), res.pagination, (p) => {
      state.page = p;
      load();
    });
  } catch (e) {
    $('rows').innerHTML = `<tr><td colspan="${cols}">${errorState(e.message)}</td></tr>`;
  }
}

$('rows').addEventListener('click', async (e) => {
  const r = e.target.closest('[data-renew]');
  if (r) return renewIssue({ transactionId: r.dataset.renew }, load);
  const d = e.target.closest('[data-detail]');
  if (d) {
    const m = openModal({ title: `Transaction ${d.dataset.detail}`, body: '<div class="skeleton sk-block"></div>', size: 'modal-lg' });
    try {
      const { data: i, return: ret, fines } = await api.get(`/issues/${d.dataset.detail}`);
      m.body.innerHTML = `<div class="row" style="gap:18px;align-items:flex-start">${bookCover(i.book, 'cover-md')}<div style="flex:1"><div class="row wrap">${badge(i.status)}<span class="tag mono">${i.transactionId}</span></div>
        <h2 style="margin:8px 0 14px">${h(i.bookTitle)}</h2>
        <div class="kv"><div><small>Member</small><strong>${h(i.memberName)} (${i.memberCode})</strong></div><div><small>Book ID</small><strong class="mono">${i.bookCode}</strong></div>
        <div><small>Issue date</small><strong>${fmtDate(i.issueDate)}</strong></div><div><small>Due date</small><strong>${fmtDate(i.dueDate)}</strong></div>
        <div><small>Return date</small><strong>${i.returnDate ? fmtDate(i.returnDate) : '—'}</strong></div><div><small>Renewals</small><strong>${i.renewalCount}</strong></div>
        <div><small>Issued by</small><strong>${h(i.staffName || '—')}</strong></div><div><small>Condition on return</small><strong>${ret ? h(ret.condition) : '—'}</strong></div></div></div></div>
        ${fines.length ? `<div class="divider"></div><h3 style="margin-bottom:8px">Charges</h3>${fines.map((f) => `<div class="row-between list-item"><span>${h(f.type)} <span class="muted small">${h(f.description)}</span></span><span>${inr(f.originalAmount)} ${badge(f.status)}</span></div>`).join('')}` : ''}`;
    } catch (err) {
      m.body.innerHTML = errorState(err.message);
    }
  }
});

load();
