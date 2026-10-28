import {
  initPage, api, h, inr, icon, badge, toast, toastError, confirmDialog, bookCover, fmtDate, errorState, emptyState, isStaff,
  hasRole, qp, avatar, navigate,
} from './app.js';
import {
  locationCard, bindFindShelf, openShelfRoute, openIssueModal, openReserveModal, openBookForm, openMoveBook, openBookCodes,
  renewIssue, bookStatus, dueLabel,
} from './shared.js';

const user = await initPage('books');
const staff = isStaff(user);
const canEdit = hasRole('admin', 'librarian');
const id = qp('id');
const root = document.getElementById('detail');

async function load() {
  if (!id) {
    root.innerHTML = emptyState('No book selected', 'Open a book from the catalogue.', 'book', '<a class="btn btn-primary" href="books.html">Browse books</a>');
    return;
  }
  try {
    const res = await api.get(`/books/${encodeURIComponent(id)}`);
    render(res);
    if (qp('find') === '1') openShelfRoute(res.data);
  } catch (e) {
    root.innerHTML = e.status === 404 ? emptyState('Book not found', `No book matches “${id}”.`, 'search', '<a class="btn btn-primary" href="books.html">Browse books</a>') : errorState(e.message);
  }
}

function copyMeter(b) {
  const cells = [
    ...Array(b.availableCopies).fill(''),
    ...Array(b.issuedCopies).fill('issued'),
    ...Array(b.reservedCopies).fill('reserved'),
    ...Array(b.damagedCopies).fill('damaged'),
    ...Array(b.lostCopies).fill('lost'),
  ].slice(0, 60);
  return `<div class="copy-meter" aria-hidden="true">${cells.map((c, i) => `<i class="${c}" style="animation-delay:${i * 40}ms" title="${c || 'available'}"></i>`).join('')}</div>`;
}

function render({ data: b, activeIssues, nextDue, reservations, queueLength, similar }) {
  document.title = `${b.title} · SmartLib`;
  document.getElementById('crumb').textContent = b.title;
  const status = bookStatus({ ...b, hasOverdue: activeIssues.some((i) => i.status === 'Overdue') });
  const myIssue = activeIssues.find((i) => String(i.member) === String(user.member?._id || user.member));
  const borrowing =
    b.availableCopies > 0
      ? `<span class="text-success">${icon('checkCircle').replace('<svg', '<svg style="width:16px;height:16px;vertical-align:-3px"')}</span> <strong>${b.availableCopies}</strong> of ${b.quantity} copies on the shelf — ready to borrow.`
      : `All copies are out.${nextDue ? ` Next copy expected <strong>${fmtDate(nextDue)}</strong>.` : ''}${queueLength ? ` <strong>${queueLength}</strong> member(s) waiting.` : ''}`;

  root.innerHTML = `
  <section class="card detail-hero">
    <div class="detail-cover">${bookCover(b, 'cover-lg')}
      <div class="row" style="justify-content:center;margin-top:14px;gap:6px">
        <button class="btn btn-sm" id="codesBtn">${icon('qr')}QR & barcode</button>
      </div></div>
    <div>
      <div class="row wrap" style="gap:8px;margin-bottom:10px">${badge(status)}<span class="tag">${h(b.categoryName)}${b.subcategory ? ` · ${h(b.subcategory)}` : ''}</span><span class="tag mono">${b.bookId}</span></div>
      <h1 class="detail-title">${h(b.title)}</h1>
      <div class="detail-meta">
        <span>${icon('pen')}<a href="authors.html?id=${b.author?.authorId || ''}">${h(b.authorName)}</a></span>
        <span>${icon('building')}${h(b.publisher || '—')}</span>
        <span>${icon('calendar')}${b.publicationDate ? new Date(b.publicationDate).getFullYear() : '—'}</span>
        <span>${icon('globe')}${h(b.language)}</span>
      </div>
      <p style="max-width:760px;color:var(--text-2)">${h(b.description || 'No description available.')}</p>
      <div class="avail-strip">
        <div class="avail-cell ${b.availableCopies ? 'hl' : ''}"><small>Available</small><strong>${b.availableCopies}</strong></div>
        <div class="avail-cell"><small>Total copies</small><strong>${b.quantity}</strong></div>
        <div class="avail-cell"><small>Issued</small><strong>${b.issuedCopies}</strong></div>
        <div class="avail-cell"><small>Reserved</small><strong>${b.reservedCopies}</strong></div>
        <div class="avail-cell"><small>Price</small><strong style="font-size:18px">${inr(b.price)}</strong></div>
      </div>
      ${copyMeter(b)}
      <p class="small" style="margin-top:10px">${borrowing}</p>
      <div class="detail-actions">
        ${staff ? `<button class="btn btn-primary" id="issueBtn" ${b.availableCopies < 1 && !b.reservedCopies ? 'disabled title="No copies available"' : ''}>${icon('bookOpen')}Issue book</button>` : ''}
        <button class="btn ${staff ? '' : 'btn-primary'}" id="reserveBtn">${icon('bookmark')}Reserve book</button>
        ${myIssue || (staff && activeIssues.length) ? `<button class="btn" id="renewBtn">${icon('refresh')}Renew book</button>` : ''}
        <button class="btn btn-gold" data-find-shelf>${icon('mapPin')}Find on shelf</button>
        ${staff ? `<button class="btn btn-ghost" id="moveBtn">${icon('move')}Move</button>` : ''}
        ${canEdit ? `<button class="btn btn-ghost" id="editBtn">${icon('edit')}Edit</button><button class="btn btn-ghost" id="deleteBtn" style="color:var(--error)">${icon('trash')}Delete</button>` : ''}
      </div>
    </div>
  </section>

  <div class="grid grid-3" style="margin-top:20px;align-items:start">
    <div class="span-2 stack">
      <div class="card card-pad">${locationCard(b)}</div>
      <div class="card">
        <div class="card-head"><div><h2>Borrowing status</h2><div class="ch-sub">${staff ? 'Copies currently with members' : 'Your loans of this book'}</div></div></div>
        <div class="card-body" id="issuesBox">${
          activeIssues.length
            ? `<div class="table-wrap"><table class="table"><thead><tr><th>Txn</th>${staff ? '<th>Member</th>' : ''}<th>Issued</th><th>Due</th><th>Renewals</th><th>Status</th><th></th></tr></thead><tbody>
            ${activeIssues.map((i, k) => `<tr style="--i:${k}"><td class="mono">${i.transactionId}</td>${staff ? `<td>${h(i.memberName)}<div class="t-sub">${i.memberCode}</div></td>` : ''}<td>${fmtDate(i.issueDate)}</td><td>${dueLabel(i)}</td><td>${i.renewalCount}</td><td>${badge(i.status)}</td>
              <td><div class="actions"><button class="btn btn-sm" data-renew="${i.transactionId}">${icon('refresh')}Renew</button>${staff ? `<a class="btn btn-sm" href="returns.html?q=${i.transactionId}">${icon('undo')}Return</a>` : ''}</div></td></tr>`).join('')}
            </tbody></table></div>`
            : emptyState(staff ? 'No copies issued' : 'You have not borrowed this book', 'All copies are in the library.', 'bookOpen')
        }</div>
      </div>
      ${
        reservations.length
          ? `<div class="card"><div class="card-head"><div><h2>Reservation queue</h2><div class="ch-sub">${queueLength} waiting</div></div></div><div class="card-body list">
        ${reservations.map((r) => `<div class="list-item">${avatar(r.member?.name || 'Member', null, 'avatar-sm')}<div class="li-main"><div class="li-title">${h(r.member?.name || 'You')}</div><div class="li-sub">${r.reservationId} · reserved ${fmtDate(r.reservationDate)}</div></div>${r.status === 'Waiting' ? `<span class="badge badge-gold plain">#${r.queuePosition} in queue</span>` : badge(r.status === 'Available' ? 'Ready for pickup' : r.status, 'badge-available')}</div>`).join('')}
      </div></div>`
          : ''
      }
    </div>
    <div class="stack">
      <div class="card card-pad">
        <h2 style="margin-bottom:14px">Book information</h2>
        <div class="kv">
          <div><small>Book ID</small><strong class="mono">${b.bookId}</strong></div>
          <div><small>ISBN</small><strong class="mono">${h(b.isbn)}</strong></div>
          <div><small>Edition</small><strong>${h(b.edition || '—')}</strong></div>
          <div><small>Pages</small><strong>${b.pages || '—'}</strong></div>
          <div><small>Language</small><strong>${h(b.language)}</strong></div>
          <div><small>Category</small><strong>${h(b.categoryName)}</strong></div>
          <div><small>Published</small><strong>${fmtDate(b.publicationDate)}</strong></div>
          <div><small>Times borrowed</small><strong>${b.timesBorrowed}</strong></div>
          ${staff ? `<div><small>Purchase price</small><strong>${inr(b.purchasePrice)}</strong></div><div><small>Current value</small><strong>${inr(b.currentValue)}</strong></div>
          <div><small>Lost copies</small><strong>${b.lostCopies}</strong></div><div><small>Damaged copies</small><strong>${b.damagedCopies}</strong></div>` : ''}
          <div><small>Date added</small><strong>${fmtDate(b.createdAt)}</strong></div>
          <div><small>Last updated</small><strong>${fmtDate(b.updatedAt)}</strong></div>
        </div>
      </div>
      ${
        similar.length
          ? `<div class="card"><div class="card-head"><h2>You may also like</h2></div><div class="card-body list">${similar
              .map((s) => `<a class="list-item" href="book-details.html?id=${s.bookId}" style="color:inherit;text-decoration:none">${bookCover(s, 'cover-xs')}<div class="li-main"><div class="li-title">${h(s.title)}</div><div class="li-sub">${h(s.authorName)}</div></div>${badge(s.availableCopies ? 'Available' : s.status)}</a>`)
              .join('')}</div></div>`
          : ''
      }
    </div>
  </div>`;

  bindFindShelf(root, b);
  const on = (sel, fn) => root.querySelector(sel)?.addEventListener('click', fn);
  on('#codesBtn', () => openBookCodes(b));
  on('#issueBtn', () => openIssueModal({ book: b, onDone: load }));
  on('#reserveBtn', () => openReserveModal({ book: b, onDone: load }));
  on('#moveBtn', () => openMoveBook(b, load));
  on('#editBtn', () => openBookForm({ book: b, onSaved: load }));
  on('#renewBtn', () => {
    const target = myIssue || activeIssues[0];
    renewIssue(target, load);
  });
  root.querySelectorAll('[data-renew]').forEach((btn) => btn.addEventListener('click', () => renewIssue({ transactionId: btn.dataset.renew }, load)));
  on('#deleteBtn', async () => {
    if (!(await confirmDialog({ title: 'Delete this book?', message: `“${h(b.title)}” will be permanently removed.`, confirmText: 'Delete', danger: true }))) return;
    try {
      await api.del(`/books/${b.bookId}`);
      toast('Book deleted');
      navigate('books.html');
    } catch (e) {
      toastError(e);
    }
  });
}

load();
