import { initPage, api, icon, toast, toastError, openModal, emptyState, errorState, renderPagination, isStaff, notifItem, bindNotifClicks, refreshUnread, validateForm, formData, applyServerErrors, withLoading } from './app.js';

const user = await initPage('notifications');
const staff = isStaff(user);
const $ = (id) => document.getElementById(id);
const state = { type: '', unread: false, page: 1 };

$('pageActions').innerHTML = `<button class="btn" id="readAll">${icon('checkCircle')}Mark all as read</button>${staff ? `<button class="btn btn-primary" id="broadcast">${icon('send')}Send notification</button>` : ''}`;
$('readAll').addEventListener('click', async () => {
  try {
    const r = await api.patch('/notifications/read-all');
    toast(`${r.updated} notification(s) marked as read`);
    refreshUnread();
    load();
  } catch (e) {
    toastError(e);
  }
});
$('broadcast')?.addEventListener('click', broadcast);

const FILTERS = [
  ['', 'All'],
  ['unread', 'Unread'],
  ['issued', 'Issued'],
  ['due-soon', 'Due soon'],
  ['overdue', 'Overdue'],
  ['fine', 'Fines'],
  ['payment', 'Payments'],
  ['reservation', 'Reservations'],
  ['membership', 'Membership'],
  ['new-book', 'New books'],
];
$('filters').innerHTML = FILTERS.map(([k, l]) => `<button class="chip ${k === '' ? 'active' : ''}" data-f="${k}">${l}</button>`).join('');
$('filters').addEventListener('click', (e) => {
  const c = e.target.closest('[data-f]');
  if (!c) return;
  $('filters').querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x === c));
  state.unread = c.dataset.f === 'unread';
  state.type = state.unread ? '' : c.dataset.f;
  state.page = 1;
  load();
});

async function load() {
  $('list').innerHTML = Array.from({ length: 6 }, () => '<div style="padding:16px"><div class="skeleton sk-line" style="width:40%"></div><div class="skeleton sk-line"></div></div>').join('');
  try {
    const res = await api.get('/notifications', { type: state.type, unread: state.unread ? 'true' : '', page: state.page, limit: 15 });
    $('sub').textContent = `${res.unread} unread · issues, due dates, overdue alerts, fines, payments and reservations.`;
    $('list').innerHTML = res.data.length ? res.data.map((n, i) => notifItem(n, i)).join('') : emptyState('You are all caught up', 'No notifications match this filter.', 'bell');
    renderPagination($('pagination'), res.pagination, (p) => {
      state.page = p;
      load();
    });
  } catch (e) {
    $('list').innerHTML = `<div style="padding:20px">${errorState(e.message)}</div>`;
  }
}
bindNotifClicks($('list'));

function broadcast() {
  const m = openModal({
    title: 'Send notification',
    body: `<form id="nF" novalidate class="stack" style="gap:14px">
      <div class="field"><label>Audience</label><select class="select" name="audience"><option value="all">Everyone</option><option value="staff">Staff only</option></select></div>
      <div class="field"><label>Title <span class="req">*</span></label><input class="input" name="title" required minlength="2" maxlength="120"></div>
      <div class="field"><label>Message <span class="req">*</span></label><textarea class="textarea" name="message" required minlength="2" maxlength="500"></textarea></div>
      <div class="field"><label>Link (optional)</label><input class="input" name="link" placeholder="books.html?sort=newest"></div></form>`,
    footer: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="nGo">${icon('send')}Send</button>`,
  });
  const form = m.el.querySelector('#nF');
  const btn = m.el.querySelector('#nGo');
  btn.onclick = async () => {
    if (!validateForm(form)) return;
    await withLoading(btn, async () => {
      try {
        await api.post('/notifications', formData(form));
        toast('Notification sent');
        m.close();
        refreshUnread();
        load();
      } catch (e) {
        applyServerErrors(form, e);
      }
    });
  };
}

load();
