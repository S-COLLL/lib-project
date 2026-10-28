import { initPage, api, h, icon, badge, toast, toastError, confirmDialog, fmtDate, skeletonRows, emptyState, errorState, renderPagination, isStaff, bookCover, avatar, daysUntil } from './app.js';
import { openReserveModal } from './shared.js';

const user = await initPage('reservations');
const staff = isStaff(user);
const $ = (id) => document.getElementById(id);
const state = { status: '', page: 1, rows: [] };

$('newRes').innerHTML = `${icon('bookmark')}New reservation`;
$('newRes').addEventListener('click', () => openReserveModal({ onDone: load }));

const TABS = ['', 'Waiting', 'Available', 'Collected', 'Cancelled', 'Expired'];
$('tabs').innerHTML = TABS.map((t) => `<button class="tab ${t === state.status ? 'active' : ''}" data-s="${t}">${t || 'All'}</button>`).join('');
$('tabs').addEventListener('click', (e) => {
  const t = e.target.closest('[data-s]');
  if (!t) return;
  state.status = t.dataset.s;
  state.page = 1;
  $('tabs').querySelectorAll('.tab').forEach((x) => x.classList.toggle('active', x === t));
  load();
});

async function load() {
  $('rows').innerHTML = skeletonRows(8, 6);
  try {
    const res = await api.get('/reservations', { status: state.status, page: state.page, limit: 15 });
    state.rows = res.data;
    $('rows').innerHTML = res.data.length
      ? res.data
          .map((r, i) => {
            const open = ['Waiting', 'Available'].includes(r.status);
            const d = r.expiryDate ? daysUntil(r.expiryDate) : null;
            return `<tr style="--i:${i}"><td class="mono">${r.reservationId}</td>
            <td><div class="row">${avatar(r.member?.name || '?', null, 'avatar-sm')}<div><div class="t-title">${h(r.member?.name)}</div><div class="t-sub">${h(r.member?.memberId)}</div></div></div></td>
            <td><div class="row">${bookCover(r.book || {}, 'cover-xs')}<div><a class="t-title" href="book-details.html?id=${r.book?.bookId}" style="color:var(--text)">${h(r.book?.title)}</a><div class="t-sub">${r.book?.bookId} · ${r.book?.availableCopies ?? 0} free</div></div></div></td>
            <td class="nowrap">${fmtDate(r.reservationDate)}</td>
            <td>${r.status === 'Waiting' ? `<span class="badge badge-gold plain">#${r.queuePosition}</span>` : '—'}</td>
            <td class="nowrap">${fmtDate(r.expiryDate)}${open && d !== null ? `<div class="small ${d <= 1 ? 'text-error' : 'muted'}">${d < 0 ? 'expired' : `${d} day${d === 1 ? '' : 's'} left`}</div>` : ''}</td>
            <td>${badge(r.status === 'Available' ? 'Available' : r.status)}${r.status === 'Available' ? '<div class="small muted">Ready for pickup</div>' : ''}</td>
            <td><div class="actions">
              ${staff && r.status === 'Available' ? `<button class="btn btn-sm btn-primary" data-collect="${r.reservationId}">${icon('bookOpen')}Issue</button>` : ''}
              ${open ? `<button class="btn btn-sm btn-danger" data-cancel="${r.reservationId}">${icon('x')}Cancel</button>` : ''}</div></td></tr>`;
          })
          .join('')
      : `<tr><td colspan="8">${emptyState('No reservations', staff ? 'Reserve an unavailable book for a member.' : 'Reserve a book that is currently issued to join the queue.', 'bookmark')}</td></tr>`;
    renderPagination($('pagination'), res.pagination, (p) => {
      state.page = p;
      load();
    });
  } catch (e) {
    $('rows').innerHTML = `<tr><td colspan="8">${errorState(e.message)}</td></tr>`;
  }
}

$('rows').addEventListener('click', async (e) => {
  const c = e.target.closest('[data-collect]');
  const x = e.target.closest('[data-cancel]');
  if (c) {
    try {
      const res = await api.patch(`/reservations/${c.dataset.collect}/collect`);
      toast(`${res.data.transactionId}: issued to ${res.data.memberName}, due ${fmtDate(res.data.dueDate)}`, 'success', 'Reservation collected');
      load();
    } catch (err) {
      toastError(err);
    }
  }
  if (x && (await confirmDialog({ title: 'Cancel reservation?', message: 'The next member in the queue will be moved up.', confirmText: 'Cancel reservation', danger: true }))) {
    try {
      await api.patch(`/reservations/${x.dataset.cancel}/cancel`);
      toast('Reservation cancelled');
      load();
    } catch (err) {
      toastError(err);
    }
  }
});

load();
