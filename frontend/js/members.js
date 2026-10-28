import {
  initPage, api, h, inr, icon, badge, avatar, toast, toastError, openModal, confirmDialog, debounce, fmtDate, isoDate, skeletonRows,
  emptyState, errorState, renderPagination, hasRole, isStaff, qp, validateForm, formData, applyServerErrors, withLoading, daysUntil,
  imageToDataUrl, bookCover,
} from './app.js';
import { openIssueModal, openPaymentModal, openReceipt, dueLabel } from './shared.js';

const user = await initPage('members');
const staff = isStaff(user);
const canDelete = hasRole('admin', 'librarian');
const $ = (id) => document.getElementById(id);
const state = { search: '', status: '', type: '', sort: 'newest', page: 1, rows: [] };

/* ------------------------- Student: own profile ------------------------- */
if (!staff) {
  $('pageTitle').textContent = 'My membership';
  $('memberCount').textContent = 'Your library card, loans, fines and payments.';
  if (!user.member) $('content').innerHTML = emptyState('No membership linked', 'Ask the librarian to link your account to a membership.', 'user');
  else renderProfile(user.member.memberId || user.member, $('content'));
} else {
  setupStaff();
}

function setupStaff() {
  $('pageActions').innerHTML = `<button class="btn btn-primary" id="addMember">${icon('plus')}Add member</button>`;
  $('addMember').addEventListener('click', () => memberForm());
  $('statusChips').innerHTML = [['', 'All'], ['Active'], ['Expired'], ['Suspended']].map(([k, l]) => `<button class="chip ${k === '' ? 'active' : ''}" data-status="${k}">${l || k}</button>`).join('');
  $('statusChips').addEventListener('click', (e) => {
    const c = e.target.closest('.chip');
    if (!c) return;
    state.status = c.dataset.status;
    $('statusChips').querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x === c));
    state.page = 1;
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
  ['type', 'sort'].forEach((k) =>
    $(k).addEventListener('change', () => {
      state[k] = $(k).value;
      state.page = 1;
      load();
    })
  );
  $('rows').addEventListener('click', onRowAction);
  load();
  if (qp('id')) openProfile(qp('id'));
}

async function load() {
  $('rows').innerHTML = skeletonRows(11, 6);
  try {
    const res = await api.get('/members', { search: state.search, status: state.status, type: state.type, sort: state.sort, page: state.page, limit: 12 });
    state.rows = res.data;
    $('memberCount').textContent = `${res.pagination.total} member${res.pagination.total === 1 ? '' : 's'} · library memberships, borrowing history and dues.`;
    $('rows').innerHTML = res.data.length
      ? res.data
          .map((m, i) => {
            const d = daysUntil(m.membershipExpiry);
            return `<tr style="--i:${i}"><td><div class="row">${avatar(m.name, m.profilePhoto)}<div><button class="link-btn t-title" data-act="view" data-id="${m.memberId}" style="color:var(--text)">${h(m.name)}</button><div class="t-sub">${h(m.email)}</div></div></div></td>
            <td class="mono">${m.memberId}${m.neptunCode ? `<div class="t-sub" title="Neptun code">${h(m.neptunCode)}</div>` : ''}</td><td>${h(m.department || '—')}<div class="t-sub">${h(m.course)} ${h(m.year)}</div></td><td>${m.membershipType === 'Premium' ? badge('Premium') : `<span class="tag">${h(m.membershipType)}</span>`}</td>
            <td class="nowrap">${fmtDate(m.membershipExpiry)}${d >= 0 && d <= 30 ? `<div class="small text-warning">in ${d} days</div>` : ''}</td>
            <td>${m.booksIssued}</td><td>${m.booksReturned}</td><td class="amount ${m.pendingFine ? 'text-error' : ''}">${inr(m.pendingFine)}</td><td class="amount">${inr(m.totalFinePaid)}</td><td>${badge(m.status)}</td>
            <td><div class="actions">
              <button class="btn btn-sm btn-icon btn-ghost" data-act="view" data-id="${m.memberId}" title="View profile" aria-label="View ${h(m.name)}">${icon('eye')}</button>
              <button class="btn btn-sm btn-icon btn-ghost" data-act="edit" data-id="${m.memberId}" title="Edit" aria-label="Edit ${h(m.name)}">${icon('edit')}</button>
              <button class="btn btn-sm btn-icon btn-ghost" data-act="issue" data-id="${m.memberId}" title="Issue book" aria-label="Issue book to ${h(m.name)}">${icon('bookOpen')}</button>
              ${canDelete ? `<button class="btn btn-sm btn-icon btn-ghost" data-act="delete" data-id="${m.memberId}" title="Delete" aria-label="Delete ${h(m.name)}">${icon('trash')}</button>` : ''}</div></td></tr>`;
          })
          .join('')
      : `<tr><td colspan="11">${emptyState('No members found', 'Try a different search.', 'users')}</td></tr>`;
    renderPagination($('pagination'), res.pagination, (p) => {
      state.page = p;
      load();
    });
  } catch (e) {
    $('rows').innerHTML = `<tr><td colspan="11">${errorState(e.message)}</td></tr>`;
  }
}

async function onRowAction(e) {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const m = state.rows.find((x) => x.memberId === b.dataset.id);
  if (b.dataset.act === 'view') openProfile(m.memberId);
  if (b.dataset.act === 'edit') memberForm(m);
  if (b.dataset.act === 'issue') openIssueModal({ member: m, onDone: load });
  if (b.dataset.act === 'delete') {
    if (!(await confirmDialog({ title: `Delete ${h(m.name)}?`, message: 'Members with issued books or pending fines cannot be deleted.', confirmText: 'Delete', danger: true }))) return;
    try {
      await api.del(`/members/${m.memberId}`);
      toast(`${m.name} deleted`);
      load();
    } catch (err) {
      toastError(err);
    }
  }
}

/* ------------------------------ Profile ------------------------------ */
function openProfile(memberId) {
  const modal = openModal({ title: 'Member profile', size: 'modal-xl', body: '<div class="skeleton sk-block"></div>' });
  renderProfile(memberId, modal.body, modal);
}

async function renderProfile(memberId, container, modal) {
  try {
    const { data: m, issues, fines, payments, reservations } = await api.get(`/members/${memberId}`);
    const d = daysUntil(m.membershipExpiry);
    const totalDays = Math.max(1, (new Date(m.membershipExpiry) - new Date(m.membershipStart)) / 86400000);
    const usedPct = Math.min(100, Math.max(0, Math.round(((totalDays - d) / totalDays) * 100)));
    const active = issues.filter((i) => ['Issued', 'Overdue'].includes(i.status));
    const outstanding = fines.filter((f) => f.remainingAmount > 0);
    container.innerHTML = `
      <div class="${modal ? '' : 'card card-pad'}">
      <div class="profile-head">
        ${avatar(m.name, m.profilePhoto, 'avatar-xl')}
        <div style="flex:1;min-width:220px"><div class="row wrap" style="gap:8px">${badge(m.status)}<span class="tag mono">${m.memberId}</span>${m.neptunCode ? `<span class="tag mono" title="Neptun code">${h(m.neptunCode)}</span>` : ''}${m.membershipType === 'Premium' ? badge('Premium') : `<span class="tag">${h(m.membershipType)}</span>`}</div>
          <h2 style="font-size:24px;margin-top:6px">${h(m.name)}</h2>
          <div class="muted small row wrap" style="gap:14px;margin-top:4px"><span>${icon('mail').replace('<svg', '<svg style="width:14px;height:14px"')} ${h(m.email)}</span><span>${icon('phone').replace('<svg', '<svg style="width:14px;height:14px"')} ${h(m.phone || '—')}</span><span>${h(m.department)} · ${h(m.course)} ${h(m.year)}</span></div></div>
        ${staff ? `<div class="row wrap"><button class="btn btn-primary btn-sm" id="pIssue">${icon('bookOpen')}Issue book</button><button class="btn btn-sm" id="pPay">${icon('card')}Record payment</button><button class="btn btn-sm" id="pRenew">${icon('refresh')}Renew membership</button><button class="btn btn-sm" id="pEdit">${icon('edit')}Edit</button></div>` : ''}
      </div>
      <div class="member-stats">
        <div><small>Books issued now</small><strong>${m.booksIssued}</strong></div>
        <div><small>Books returned</small><strong>${m.booksReturned}</strong></div>
        <div><small>Pending fine</small><strong class="${m.pendingFine ? 'text-error' : ''}">${inr(m.pendingFine)}</strong></div>
        <div><small>Total fine paid</small><strong>${inr(m.totalFinePaid)}</strong></div>
      </div>
      <div class="callout ${d < 0 ? 'error' : d <= 30 ? 'warn' : ''}">${icon('calendar')}<div style="flex:1">Membership ${fmtDate(m.membershipStart)} → <strong>${fmtDate(m.membershipExpiry)}</strong> ${d < 0 ? `(expired ${-d} days ago)` : `(${d} days left)`}
        <div class="progress expiry-bar"><span style="width:${usedPct}%"></span></div></div></div>
      </div>
      <div class="tabs" style="margin:18px 0 12px" id="pTabs">
        <button class="tab active" data-t="loans">Current loans <span class="count">${active.length}</span></button>
        <button class="tab" data-t="history">History <span class="count">${issues.length}</span></button>
        <button class="tab" data-t="fines">Fines <span class="count">${outstanding.length}</span></button>
        <button class="tab" data-t="payments">Payments <span class="count">${payments.length}</span></button>
        <button class="tab" data-t="res">Reservations <span class="count">${reservations.length}</span></button>
      </div>
      <div id="pTab" class="${modal ? '' : 'card card-pad'}"></div>`;

    const issueRow = (i) => `<tr><td class="mono">${i.transactionId}</td><td><div class="row">${bookCover(i.book || { title: i.bookTitle }, 'cover-xs')}<div><div class="t-title">${h(i.bookTitle)}</div><div class="t-sub">${h(i.bookCode)}</div></div></div></td><td>${fmtDate(i.issueDate)}</td><td>${dueLabel(i)}</td><td>${i.returnDate ? fmtDate(i.returnDate) : '—'}</td><td>${i.renewalCount}</td><td>${badge(i.status)}</td><td class="amount">${i.fineAmount ? inr(i.fineAmount) : '—'}</td></tr>`;
    const issueTable = (list) => (list.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Txn</th><th>Book</th><th>Issued</th><th>Due</th><th>Returned</th><th>Renewals</th><th>Status</th><th>Fine</th></tr></thead><tbody>${list.map(issueRow).join('')}</tbody></table></div>` : emptyState('Nothing here yet', '', 'book'));
    const tabs = {
      loans: () => issueTable(active),
      history: () => issueTable(issues),
      fines: () =>
        fines.length
          ? `<div class="table-wrap"><table class="table"><thead><tr><th>Fine</th><th>Type</th><th>Details</th><th>Original</th><th>Discount</th><th>Paid</th><th>Remaining</th><th>Status</th>${staff ? '<th></th>' : ''}</tr></thead><tbody>${fines
              .map((f) => `<tr><td class="mono">${f.fineId}</td><td>${h(f.type)}</td><td class="small">${h(f.description)}</td><td class="amount">${inr(f.originalAmount)}</td><td class="amount">${inr(f.discount)}</td><td class="amount">${inr(f.paidAmount)}</td><td class="amount ${f.remainingAmount ? 'text-error' : ''}">${inr(f.remainingAmount)}</td><td>${badge(f.status)}</td>
                ${staff ? `<td>${f.remainingAmount > 0 ? `<button class="btn btn-sm btn-primary" data-payfine="${f.fineId}">Pay</button>` : ''}</td>` : ''}</tr>`)
              .join('')}</tbody></table></div>`
          : emptyState('No fines', 'This member has a clean record.', 'checkCircle'),
      payments: () =>
        payments.length
          ? `<div class="table-wrap"><table class="table"><thead><tr><th>Payment</th><th>Date</th><th>Reason</th><th>Method</th><th>Amount</th><th>Status</th><th></th></tr></thead><tbody>${payments
              .map((p) => `<tr><td class="mono">${p.paymentId}</td><td>${fmtDate(p.date)}</td><td class="small">${h(p.reason)}</td><td>${h(p.method)}</td><td class="amount">${inr(p.amount)}</td><td>${badge(p.status)}</td><td>${p.receiptNo ? `<button class="btn btn-sm" data-receipt="${p.paymentId}">${icon('receipt')}Receipt</button>` : ''}</td></tr>`)
              .join('')}</tbody></table></div>`
          : emptyState('No payments yet', '', 'card'),
      res: () =>
        reservations.length
          ? `<div class="list">${reservations.map((r) => `<div class="list-item"><div class="li-main"><div class="li-title">${h(r.book?.title)}</div><div class="li-sub">${r.reservationId} · ${fmtDate(r.reservationDate)}${r.status === 'Waiting' ? ` · #${r.queuePosition} in queue` : ''}</div></div>${badge(r.status)}</div>`).join('')}</div>`
          : emptyState('No reservations', '', 'bookmark'),
    };
    const tabBox = container.querySelector('#pTab');
    const show = (t) => {
      tabBox.innerHTML = tabs[t]();
      tabBox.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 260, easing: 'cubic-bezier(0.22,1,0.36,1)' });
    };
    container.querySelector('#pTabs').addEventListener('click', (e) => {
      const t = e.target.closest('[data-t]');
      if (!t) return;
      container.querySelectorAll('#pTabs .tab').forEach((x) => x.classList.toggle('active', x === t));
      show(t.dataset.t);
    });
    show('loans');
    const refresh = () => {
      renderProfile(memberId, container, modal);
      if (staff) load();
    };
    tabBox.addEventListener('click', (e) => {
      const pf = e.target.closest('[data-payfine]');
      const rc = e.target.closest('[data-receipt]');
      if (pf) openPaymentModal({ fine: { ...fines.find((f) => f.fineId === pf.dataset.payfine), member: m }, onDone: refresh });
      if (rc) openReceipt(rc.dataset.receipt);
    });
    container.querySelector('#pIssue')?.addEventListener('click', () => openIssueModal({ member: m, onDone: refresh }));
    container.querySelector('#pPay')?.addEventListener('click', () => openPaymentModal({ member: m, onDone: refresh }));
    container.querySelector('#pEdit')?.addEventListener('click', () => {
      modal?.close();
      memberForm(m);
    });
    container.querySelector('#pRenew')?.addEventListener('click', () => renewForm(m, refresh));
  } catch (e) {
    container.innerHTML = errorState(e.message);
  }
}

function renewForm(m, onDone) {
  const md = openModal({
    title: 'Renew membership',
    subtitle: `${h(m.name)} · currently valid until ${fmtDate(m.membershipExpiry)}`,
    size: 'modal-sm',
    body: `<form id="renewF" class="stack" style="gap:14px"><div class="field"><label>Extend by</label><select class="select" name="months"><option value="6">6 months</option><option value="12" selected>12 months</option><option value="24">24 months</option></select></div>
      <div class="field"><label>Fee (₹)</label><input class="input" type="number" name="amount" min="0" value="500"></div>
      <div class="field"><label>Payment method</label><select class="select" name="method"><option>Cash</option><option>UPI</option><option>Card</option><option>Bank Transfer</option></select></div></form>`,
    footer: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="renewGo">${icon('refresh')}Renew & collect fee</button>`,
  });
  const btn = md.el.querySelector('#renewGo');
  btn.onclick = () =>
    withLoading(btn, async () => {
      const d = formData(md.el.querySelector('#renewF'));
      try {
        const res = await api.patch(`/members/${m.memberId}/renew`, { months: Number(d.months), amount: Number(d.amount), method: d.method });
        toast(`Valid until ${fmtDate(res.data.membershipExpiry)}`, 'success', 'Membership renewed');
        md.close();
        onDone?.();
        if (res.payment) openReceipt(res.payment.paymentId);
      } catch (e) {
        toastError(e);
      }
    });
}

function memberForm(m = null) {
  const md = openModal({
    title: m ? `Edit ${m.name}` : 'Add member',
    subtitle: m ? m.memberId : 'Creates a library membership (a login can be added from Settings → Users).',
    size: 'modal-lg',
    body: `<form id="memberForm" novalidate class="form-grid">
      <div class="full row" style="gap:16px"><div id="photoPrev">${avatar(m?.name || '?', m?.profilePhoto, 'avatar-lg')}</div>
        <label class="btn btn-sm">${icon('upload')}Upload photo<input type="file" accept="image/*" id="photoFile" hidden></label><input type="hidden" name="profilePhoto" value="${h(m?.profilePhoto || '')}"></div>
      <div class="field"><label>Full name <span class="req">*</span></label><input class="input" name="name" required minlength="2" value="${h(m?.name || '')}"></div>
      <div class="field"><label>Email <span class="req">*</span></label><input class="input" type="email" name="email" required value="${h(m?.email || '')}"></div>
      <div class="field"><label>Neptun code</label><input class="input mono" name="neptunCode" maxlength="6" pattern="[A-Za-z0-9]{6}" title="6 letters or digits" style="text-transform:uppercase" value="${h(m?.neptunCode || '')}" placeholder="ABC123"></div>
      <div class="field"><label>Phone</label><input class="input" name="phone" pattern="[+0-9][0-9 \\-]{7,15}" title="Enter a valid phone number" value="${h(m?.phone || '')}" placeholder="+36 30 123 4567"></div>
      <div class="field"><label>Department</label><input class="input" name="department" value="${h(m?.department || '')}"></div>
      <div class="field"><label>Course</label><input class="input" name="course" value="${h(m?.course || '')}"></div>
      <div class="field"><label>Year</label><input class="input" name="year" value="${h(m?.year || '')}"></div>
      <div class="field"><label>Membership type</label><select class="select" name="membershipType">${['Student', 'Faculty', 'Staff', 'Premium', 'Guest'].map((t) => `<option ${m?.membershipType === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      <div class="field"><label>Account status</label><select class="select" name="status">${['Active', 'Expired', 'Suspended'].map((t) => `<option ${m?.status === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
      <div class="field"><label>Membership start <span class="req">*</span></label><input class="input" type="date" name="membershipStart" required value="${isoDate(m?.membershipStart || new Date())}"></div>
      <div class="field"><label>Membership expiry <span class="req">*</span></label><input class="input" type="date" name="membershipExpiry" required value="${isoDate(m?.membershipExpiry || new Date(Date.now() + 365 * 86400000))}"></div>
      ${m ? '' : '<div class="field full"><label class="switch"><input type="checkbox" name="collectFee" checked><span class="track"></span><span>Collect membership fee now (₹500, cash)</span></label></div>'}
    </form>`,
    footer: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="memberSave">${icon('check')}${m ? 'Save changes' : 'Add member'}</button>`,
  });
  const form = md.el.querySelector('#memberForm');
  md.el.querySelector('#photoFile').addEventListener('change', async (e) => {
    try {
      form.profilePhoto.value = await imageToDataUrl(e.target.files[0], 240);
      md.el.querySelector('#photoPrev').innerHTML = avatar(form.name.value, form.profilePhoto.value, 'avatar-lg');
    } catch (err) {
      toastError(err);
    }
  });
  const btn = md.el.querySelector('#memberSave');
  btn.onclick = async () => {
    if (!validateForm(form, (d) => (new Date(d.membershipExpiry) <= new Date(d.membershipStart) ? { membershipExpiry: 'Expiry must be after the start date' } : {}))) return;
    const d = formData(form);
    if (!d.phone) delete d.phone;
    await withLoading(btn, async () => {
      try {
        const res = m ? await api.put(`/members/${m.memberId}`, d) : await api.post('/members', d);
        toast(m ? 'Member updated' : `${res.data.name} added as ${res.data.memberId}`);
        md.close();
        load();
      } catch (e) {
        applyServerErrors(form, e);
      }
    });
  };
}
