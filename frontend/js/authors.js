import {
  initPage, api, h, icon, avatar, toast, toastError, openModal, confirmDialog, debounce, emptyState, errorState, hasRole, qp, bookCover,
  badge, validateForm, formData, applyServerErrors, withLoading, imageToDataUrl, skeletonCards,
} from './app.js';

await initPage('authors');
const canEdit = hasRole('admin', 'librarian');
const $ = (id) => document.getElementById(id);
let authors = [];

if (canEdit) {
  $('pageActions').innerHTML = `<button class="btn btn-primary" id="add">${icon('plus')}Add author</button>`;
  $('add').addEventListener('click', () => authorForm());
}

async function load(search = '') {
  $('grid').innerHTML = skeletonCards(8, 150);
  try {
    const { data } = await api.get('/authors', { search });
    authors = data;
    $('count').textContent = `${data.length} author${data.length === 1 ? '' : 's'} in the collection.`;
    $('grid').innerHTML = data.length
      ? data
          .map(
            (a, i) => `<article class="card entity-card reveal" style="--i:${Math.min(i, 16)}" data-id="${a.authorId}" tabindex="0" role="button" aria-label="${h(a.name)}">
          <div class="row">${avatar(a.name, a.profileImage, 'avatar-lg')}<div style="min-width:0"><h3 style="font-size:16px">${h(a.name)}</h3><div class="small muted">${icon('globe').replace('<svg', '<svg style="width:13px;height:13px;vertical-align:-2px"')} ${h(a.country || '—')}</div><span class="tag mono">${a.authorId}</span></div></div>
          <p class="bio">${h(a.biography || 'No biography yet.')}</p>
          <div class="ec-foot"><span><strong>${a.bookCount}</strong> books</span><span><strong>${a.totalCopies}</strong> copies</span><span><strong>${a.timesBorrowed}</strong> loans</span></div></article>`
          )
          .join('')
      : `<div style="grid-column:1/-1">${emptyState('No authors found')}</div>`;
  } catch (e) {
    $('grid').innerHTML = `<div style="grid-column:1/-1">${errorState(e.message)}</div>`;
  }
}

$('search').addEventListener('input', debounce(() => load($('search').value.trim())));
$('grid').addEventListener('click', (e) => {
  const c = e.target.closest('[data-id]');
  if (c) openAuthor(c.dataset.id);
});
$('grid').addEventListener('keydown', (e) => {
  const c = e.target.closest('[data-id]');
  if (c && e.key === 'Enter') openAuthor(c.dataset.id);
});

async function openAuthor(id) {
  const m = openModal({ title: 'Author', size: 'modal-lg', body: '<div class="skeleton sk-block"></div>' });
  try {
    const { data: a, books } = await api.get(`/authors/${id}`);
    m.el.querySelector('.modal-head h2').textContent = a.name;
    m.body.innerHTML = `<div class="row" style="gap:18px;align-items:flex-start">${avatar(a.name, a.profileImage, 'avatar-xl')}
      <div style="flex:1"><div class="row wrap"><span class="tag mono">${a.authorId}</span><span class="tag">${h(a.country || 'Unknown country')}</span><span class="badge badge-gold plain">${books.length} book${books.length === 1 ? '' : 's'}</span></div>
      <p style="margin-top:10px;color:var(--text-2)">${h(a.biography || 'No biography yet.')}</p>
      ${canEdit ? `<div class="row" style="margin-top:12px"><button class="btn btn-sm" id="aEdit">${icon('edit')}Edit</button><button class="btn btn-sm btn-danger" id="aDel">${icon('trash')}Delete</button></div>` : ''}</div></div>
      <div class="divider"></div><h3 style="margin-bottom:12px">Books by ${h(a.name)}</h3>
      ${books.length ? `<div class="author-books">${books.map((b) => `<a href="book-details.html?id=${b.bookId}">${bookCover(b, 'cover-md')}${h(b.title)}<div>${badge(b.availableCopies ? 'Available' : b.status)}</div></a>`).join('')}</div>` : emptyState('No books yet')}`;
    m.body.querySelector('#aEdit')?.addEventListener('click', () => {
      m.close();
      authorForm(a);
    });
    m.body.querySelector('#aDel')?.addEventListener('click', async () => {
      if (!(await confirmDialog({ title: `Delete ${h(a.name)}?`, message: 'Authors with books cannot be deleted.', confirmText: 'Delete', danger: true }))) return;
      try {
        await api.del(`/authors/${a.authorId}`);
        toast('Author deleted');
        m.close();
        load();
      } catch (err) {
        toastError(err);
      }
    });
  } catch (e) {
    m.body.innerHTML = errorState(e.message);
  }
}

function authorForm(a = null) {
  const m = openModal({
    title: a ? `Edit ${a.name}` : 'Add author',
    body: `<form id="aF" novalidate class="form-grid">
      <div class="full row" style="gap:14px"><div id="aPrev">${avatar(a?.name || '?', a?.profileImage, 'avatar-lg')}</div><label class="btn btn-sm">${icon('upload')}Upload photo<input type="file" accept="image/*" id="aFile" hidden></label><input type="hidden" name="profileImage" value="${h(a?.profileImage || '')}"></div>
      <div class="field"><label>Name <span class="req">*</span></label><input class="input" name="name" required minlength="2" value="${h(a?.name || '')}"></div>
      <div class="field"><label>Country</label><input class="input" name="country" value="${h(a?.country || '')}"></div>
      <div class="field full"><label>Biography</label><textarea class="textarea" name="biography" maxlength="3000">${h(a?.biography || '')}</textarea></div></form>`,
    footer: `<button class="btn" data-close>Cancel</button><button class="btn btn-primary" id="aSave">${icon('check')}Save</button>`,
  });
  const form = m.el.querySelector('#aF');
  m.el.querySelector('#aFile').addEventListener('change', async (e) => {
    try {
      form.profileImage.value = await imageToDataUrl(e.target.files[0], 240);
      m.el.querySelector('#aPrev').innerHTML = avatar(form.name.value, form.profileImage.value, 'avatar-lg');
    } catch (err) {
      toastError(err);
    }
  });
  const btn = m.el.querySelector('#aSave');
  btn.onclick = async () => {
    if (!validateForm(form)) return;
    await withLoading(btn, async () => {
      try {
        const d = formData(form);
        if (a) await api.put(`/authors/${a.authorId}`, d);
        else await api.post('/authors', d);
        toast('Author saved');
        m.close();
        load();
      } catch (e) {
        applyServerErrors(form, e);
      }
    });
  };
}

await load();
if (qp('id')) openAuthor(qp('id'));
