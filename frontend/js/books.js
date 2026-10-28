import {
  initPage, api, h, inr, num, icon, badge, toast, toastError, openModal, confirmDialog, debounce, bookCover, skeletonRows,
  emptyState, errorState, renderPagination, hasRole, isStaff, qp, locationInline, withLoading, navigate,
} from './app.js';
import { openBookForm, openIssueModal, openReserveModal, bookStatus } from './shared.js';

const user = await initPage('books');
const canEdit = hasRole('admin', 'librarian');
const staff = isStaff(user);

const $ = (id) => document.getElementById(id);
const state = {
  search: qp('search') || '',
  status: qp('status') || '',
  category: qp('category') || '',
  language: qp('language') || '',
  floor: qp('floor') || '',
  sort: qp('sort') || 'newest',
  page: Number(qp('page')) || 1,
  view: (() => {
    try {
      return localStorage.getItem('smartlib-books-view') || 'table';
    } catch {
      return 'table';
    }
  })(),
  selected: new Set(),
  rows: [],
};
const LIMIT = 12;

/* ------------------------------ Setup ------------------------------ */
if (canEdit) {
  $('pageActions').innerHTML = `<button class="btn btn-primary" id="addBook">${icon('plus')}Add book</button>`;
  $('addBook').addEventListener('click', () => openBookForm({ onSaved: (b) => navigate(`book-details.html?id=${b.bookId}`) }));
}
if (staff) $('pageActions').insertAdjacentHTML('afterbegin', `<button class="btn" id="exportAll">${icon('download')}Export CSV</button>`);
$('exportAll')?.addEventListener('click', async (e) => {
  await withLoading(e.currentTarget, async () => {
    const { data } = await api.get('/books', { ...filters(), page: 1, limit: 500 });
    exportCsv(data, 'smartlib-books.csv');
  });
});

document.querySelector('[data-view=table]').innerHTML = icon('list');
document.querySelector('[data-view=grid]').innerHTML = icon('grid');
document.querySelectorAll('[data-view]').forEach((b) => {
  b.classList.toggle('active', b.dataset.view === state.view);
  b.addEventListener('click', () => {
    state.view = b.dataset.view;
    try {
      localStorage.setItem('smartlib-books-view', state.view);
    } catch {
      /* ignore */
    }
    document.querySelectorAll('[data-view]').forEach((x) => x.classList.toggle('active', x === b));
    render();
  });
});

const STATUSES = [
  ['', 'All'],
  ['available', 'Available'],
  ['issued', 'Issued'],
  ['reserved', 'Reserved'],
  ['overdue', 'Overdue'],
  ['lost', 'Lost'],
  ['damaged', 'Damaged'],
];
$('statusChips').innerHTML = STATUSES.map(([k, l]) => `<button class="chip ${state.status === k ? 'active' : ''}" data-status="${k}">${k ? '<span class="dot"></span>' : ''}${l}</button>`).join('');
$('statusChips').addEventListener('click', (e) => {
  const c = e.target.closest('.chip');
  if (!c) return;
  state.status = c.dataset.status;
  $('statusChips').querySelectorAll('.chip').forEach((x) => x.classList.toggle('active', x === c));
  state.page = 1;
  load();
});

$('search').value = state.search;
$('sort').value = state.sort;
let historyTimer;
$('search').addEventListener(
  'input',
  debounce(() => {
    state.search = $('search').value.trim();
    state.page = 1;
    load();
    clearTimeout(historyTimer);
    if (state.search.length >= 3) historyTimer = setTimeout(() => api.post('/auth/search-history', { term: state.search }).catch(() => {}), 1500);
  }, 250)
);
$('sort').addEventListener('change', () => {
  state.sort = $('sort').value;
  load();
});
['category', 'language', 'floor'].forEach((k) =>
  $(k).addEventListener('change', () => {
    state[k] = $(k).value;
    state.page = 1;
    load();
  })
);

api
  .get('/books/meta')
  .then(({ data }) => {
    $('category').insertAdjacentHTML('beforeend', data.categories.map((c) => `<option ${c.name === state.category ? 'selected' : ''}>${h(c.name)}</option>`).join(''));
    $('language').insertAdjacentHTML('beforeend', data.languages.map((l) => `<option ${l === state.language ? 'selected' : ''}>${h(l)}</option>`).join(''));
    $('floor').insertAdjacentHTML('beforeend', data.floors.map((f) => `<option value="${f}" ${String(f) === state.floor ? 'selected' : ''}>Floor ${f}</option>`).join(''));
  })
  .catch(() => {});

/* ------------------------------ Data ------------------------------ */
const filters = () => ({ search: state.search, status: state.status, category: state.category, language: state.language, floor: state.floor, sort: state.sort });

function syncUrl() {
  const p = new URLSearchParams();
  Object.entries({ ...filters(), page: state.page > 1 ? state.page : '' }).forEach(([k, v]) => v && !(k === 'sort' && v === 'newest') && p.set(k, v));
  history.replaceState(null, '', `${location.pathname}${p.toString() ? `?${p}` : ''}`);
}

let reqId = 0;
async function load() {
  const my = ++reqId;
  syncUrl();
  $('results').innerHTML =
    state.view === 'table'
      ? `<div class="table-wrap"><table class="table"><tbody>${skeletonRows(9, 6)}</tbody></table></div>`
      : `<div class="book-grid">${Array.from({ length: 8 }, () => '<div class="skeleton" style="height:320px;border-radius:16px"></div>').join('')}</div>`;
  try {
    const res = await api.get('/books', { ...filters(), page: state.page, limit: LIMIT });
    if (my !== reqId) return;
    state.rows = res.data;
    state.pagination = res.pagination;
    $('bookCount').textContent = `${num(res.pagination.total)} book title${res.pagination.total === 1 ? '' : 's'} match${res.pagination.total === 1 ? 'es' : ''} your filters.`;
    render();
  } catch (e) {
    if (my === reqId) $('results').innerHTML = `<div style="padding:20px">${errorState(e.message)}</div>`;
  }
}

/* ------------------------------ Render ------------------------------ */
const statusBadge = (b) => badge(bookStatus(b));

function actions(b, compact = false) {
  const btn = (act, ic, title, cls = 'btn-ghost') => `<button class="btn ${cls} btn-sm btn-icon" data-act="${act}" data-id="${b.bookId}" title="${title}" aria-label="${title} ${h(b.title)}">${icon(ic)}</button>`;
  return [
    btn('view', 'eye', 'View'),
    canEdit ? btn('edit', 'edit', 'Edit') : '',
    staff && !compact ? btn('issue', 'bookOpen', 'Issue') : '',
    btn('reserve', 'bookmark', 'Reserve'),
    canEdit && !compact ? btn('delete', 'trash', 'Delete') : '',
  ].join('');
}

function render() {
  const rows = state.rows;
  if (!rows.length) {
    $('results').innerHTML = emptyState('No books found', 'Try a different search or clear the filters.', 'search', `<button class="btn" id="clearFilters">${icon('x')}Clear filters</button>`);
    $('clearFilters')?.addEventListener('click', clearFilters);
    $('pagination').innerHTML = '';
    return;
  }
  if (state.view === 'table') {
    $('results').innerHTML = `<div class="table-wrap"><table class="table">
      <thead><tr>
        ${canEdit ? '<th style="width:36px"><input type="checkbox" class="checkbox" id="checkAll" aria-label="Select all"></th>' : ''}
        <th>Book ID</th><th>Cover</th><th class="sortable" data-sort="az">Book Name <span class="sort-ind">↕</span></th><th>Author</th><th>Category</th><th>ISBN</th>
        <th>Available</th><th>Total</th><th class="sortable" data-sort="price_asc">Price <span class="sort-ind">↕</span></th><th>Shelf</th><th>Status</th><th style="text-align:right">Actions</th>
      </tr></thead>
      <tbody>${rows
        .map(
          (b, i) => `<tr style="--i:${i}" class="${state.selected.has(b._id) ? 'selected' : ''}">
          ${canEdit ? `<td><input type="checkbox" class="checkbox row-check" data-id="${b._id}" ${state.selected.has(b._id) ? 'checked' : ''} aria-label="Select ${h(b.title)}"></td>` : ''}
          <td class="mono nowrap">${b.bookId}</td>
          <td>${bookCover(b, 'cover-sm')}</td>
          <td style="min-width:200px"><a class="t-title" href="book-details.html?id=${b.bookId}" style="color:var(--text)">${h(b.title)}</a><div class="t-sub">${h(b.publisher || '')}${b.edition ? ` · ${h(b.edition)} ed.` : ''} · ${h(b.language)}</div></td>
          <td>${h(b.authorName)}</td>
          <td><span class="tag">${h(b.categoryName)}</span></td>
          <td class="mono small">${h(b.isbn)}</td>
          <td class="copies ${b.availableCopies ? 'text-success' : 'text-error'}">${b.availableCopies}</td>
          <td class="copies">${b.quantity}</td>
          <td class="amount nowrap">${inr(b.price)}</td>
          <td class="nowrap">${locationInline(b.location)}</td>
          <td>${statusBadge(b)}</td>
          <td><div class="actions">${actions(b)}</div></td></tr>`
        )
        .join('')}</tbody></table></div>`;
    document.querySelectorAll('th[data-sort]').forEach((th) => {
      const s = th.dataset.sort;
      const active = state.sort === s || state.sort === { az: 'za', price_asc: 'price_desc' }[s];
      th.classList.toggle('sorted', active);
      if (active) th.querySelector('.sort-ind').textContent = ['za', 'price_desc'].includes(state.sort) ? '↓' : '↑';
      th.addEventListener('click', () => {
        const pair = { az: ['az', 'za'], price_asc: ['price_asc', 'price_desc'] }[s];
        state.sort = state.sort === pair[0] ? pair[1] : pair[0];
        $('sort').value = state.sort;
        load();
      });
    });
  } else {
    $('results').innerHTML = `<div class="book-grid">${rows
      .map(
        (b, i) => `<article class="book-card reveal" style="--i:${i}">
        ${canEdit ? `<input type="checkbox" class="checkbox row-check bc-check" data-id="${b._id}" ${state.selected.has(b._id) ? 'checked' : ''} aria-label="Select ${h(b.title)}">` : ''}
        <a class="bc-cover" href="book-details.html?id=${b.bookId}" aria-label="${h(b.title)}">${bookCover(b, 'cover-md')}</a>
        <div class="bc-body"><div class="row-between">${statusBadge(b)}<span class="mono small muted">${b.bookId}</span></div>
          <a class="bc-title" href="book-details.html?id=${b.bookId}">${h(b.title)}</a><div class="bc-author">${h(b.authorName)} · ${h(b.categoryName)}</div>
          ${locationInline(b.location)}
          <div class="bc-foot"><span class="amount">${inr(b.price)}</span><span class="copies">${b.availableCopies}<small> / ${b.quantity} available</small></span></div></div>
        <div class="bc-actions">${actions(b, true)}</div></article>`
      )
      .join('')}</div>`;
  }
  renderPagination($('pagination'), state.pagination, (p) => {
    state.page = p;
    load();
    document.querySelector('.card').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  bindSelection();
}

/* ------------------------------ Actions ------------------------------ */
$('results').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const book = state.rows.find((x) => x.bookId === b.dataset.id);
  switch (b.dataset.act) {
    case 'view':
      navigate(`book-details.html?id=${book.bookId}`);
      break;
    case 'edit': {
      const { data } = await api.get(`/books/${book.bookId}`).catch((err) => (toastError(err), {}));
      if (data) openBookForm({ book: data, onSaved: load });
      break;
    }
    case 'issue':
      openIssueModal({ book, onDone: load });
      break;
    case 'reserve':
      openReserveModal({ book, onDone: load });
      break;
    case 'delete':
      if (await confirmDialog({ title: 'Delete book?', message: `“${h(book.title)}” (${book.bookId}) will be permanently removed from the catalogue.`, confirmText: 'Delete', danger: true })) {
        try {
          await api.del(`/books/${book.bookId}`);
          toast(`“${book.title}” deleted`);
          load();
        } catch (err) {
          toastError(err);
        }
      }
      break;
    default:
  }
});

function bindSelection() {
  document.querySelectorAll('.row-check').forEach((c) =>
    c.addEventListener('change', () => {
      if (c.checked) state.selected.add(c.dataset.id);
      else state.selected.delete(c.dataset.id);
      c.closest('tr')?.classList.toggle('selected', c.checked);
      updateBulk();
    })
  );
  const all = $('checkAll');
  if (all) {
    all.checked = state.rows.length > 0 && state.rows.every((r) => state.selected.has(r._id));
    all.addEventListener('change', () => {
      state.rows.forEach((r) => (all.checked ? state.selected.add(r._id) : state.selected.delete(r._id)));
      render();
      updateBulk();
    });
  }
  updateBulk();
}

function updateBulk() {
  const bar = $('bulkBar');
  const n = state.selected.size;
  bar.classList.toggle('hidden', !n);
  if (!n) return;
  bar.innerHTML = `<strong>${n} selected</strong>
    <button class="btn btn-sm" data-bulk="move">${icon('move')}Move to shelf</button>
    <button class="btn btn-sm" data-bulk="category">${icon('folder')}Change category</button>
    <button class="btn btn-sm" data-bulk="export">${icon('download')}Export</button>
    <button class="btn btn-sm btn-danger" data-bulk="delete">${icon('trash')}Delete</button>
    <button class="btn btn-sm btn-ghost" data-bulk="clear" style="margin-left:auto">Clear selection</button>`;
}

$('bulkBar').addEventListener('click', async (e) => {
  const b = e.target.closest('[data-bulk]');
  if (!b) return;
  const ids = [...state.selected];
  const act = b.dataset.bulk;
  if (act === 'clear') {
    state.selected.clear();
    render();
    return;
  }
  if (act === 'export') {
    const { data } = await api.get('/books', { page: 1, limit: 500 });
    exportCsv(data.filter((x) => state.selected.has(x._id)), 'smartlib-selected-books.csv');
    return;
  }
  if (act === 'delete') {
    if (!(await confirmDialog({ title: `Delete ${ids.length} books?`, message: 'Books that are currently issued will be skipped.', confirmText: 'Delete', danger: true }))) return;
    return runBulk({ action: 'delete', ids });
  }
  if (act === 'move' || act === 'category') {
    const [shelves, cats] = await Promise.all([api.get('/shelves'), api.get('/categories')]).catch((err) => (toastError(err), []));
    if (!shelves) return;
    const opts = act === 'move' ? shelves.data.map((s) => `<option value="${s.shelfId}">${h(s.name)} — F${s.floor} ${h(s.section)} (${s.availableSpace} free)</option>`) : cats.data.map((c) => `<option value="${c._id}">${h(c.name)}</option>`);
    const m = openModal({
      title: act === 'move' ? `Move ${ids.length} books` : `Change category of ${ids.length} books`,
      size: 'modal-sm',
      body: `<div class="field"><label>${act === 'move' ? 'Target shelf' : 'Category'}</label><select class="select" id="bulkTarget">${opts.join('')}</select></div>
        ${act === 'move' ? '<p class="field-hint" style="margin-top:8px">Rack, row and position are kept; adjust individual books afterwards if needed.</p>' : ''}`,
      footer: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="bulkGo">Apply</button>`,
    });
    m.el.querySelector('#bulkGo').onclick = async (ev) => {
      const v = m.el.querySelector('#bulkTarget').value;
      await withLoading(ev.currentTarget, () => runBulk(act === 'move' ? { action: 'move', ids, shelf: v } : { action: 'category', ids, category: v }));
      m.close();
    };
  }
});

async function runBulk(body) {
  try {
    const res = await api.post('/books/bulk', body);
    toast(res.message, res.data.failed.length ? 'warning' : 'success');
    res.data.failed.forEach((f) => toast(`${f.id}: ${f.reason}`, 'warning'));
    state.selected.clear();
    load();
  } catch (e) {
    toastError(e);
  }
}

function exportCsv(rows, filename) {
  const cols = ['bookId', 'title', 'authorName', 'categoryName', 'isbn', 'publisher', 'language', 'quantity', 'availableCopies', 'issuedCopies', 'price'];
  const head = [...cols, 'floor', 'section', 'shelf', 'rack', 'row', 'position', 'status'];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [head.join(','), ...rows.map((b) => [...cols.map((c) => b[c]), b.location?.floor, b.location?.section, b.location?.shelfCode, b.location?.rack, b.location?.row, b.location?.position, bookStatus(b)].map(esc).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿', csv], { type: 'text/csv;charset=utf-8' }));
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
  toast(`${rows.length} books exported`);
}

function clearFilters() {
  Object.assign(state, { search: '', status: '', category: '', language: '', floor: '', page: 1 });
  $('search').value = '';
  ['category', 'language', 'floor'].forEach((k) => ($(k).value = ''));
  $('statusChips').querySelectorAll('.chip').forEach((c, i) => c.classList.toggle('active', i === 0));
  load();
}

load();
